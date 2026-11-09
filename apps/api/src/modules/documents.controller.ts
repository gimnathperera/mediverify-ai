import { createHash } from 'node:crypto';

import { documentsRepo, referencesRepo, withTransaction, type pg } from '@mediverify/db';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  DOCX_MIME,
  extensionOf,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  sniffDocumentType,
  uploadFieldsSchema,
  type DocumentDto,
  type UploadResponse,
  type UserDto,
} from '@mediverify/shared';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import multer from 'multer';
import type { Logger } from 'pino';

import { ApiError } from '../common/api-error.js';
import { CurrentUser } from '../common/auth.js';
import { parseOrThrow, uuidParam } from '../common/zod.js';
import type { AppConfig } from '../config.js';
import { APP_CONFIG, LOGGER, PG_POOL, UPLOAD_FAULT_HOOK, type UploadFaultHook } from '../tokens.js';

@Controller('documents')
export class DocumentsController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(UPLOAD_FAULT_HOOK) private readonly faultHook: UploadFaultHook,
  ) {}

  /**
   * Upload: validates the file, then in ONE transaction inserts document (bytes) + job + 8 stage rows
   * + 'job.queued' event and NOTIFYs the worker (delivered on commit). Responds immediately with
   * 202 + ids; the pipeline runs in the worker. Same owner + same content + same reference within
   * DUPLICATE_WINDOW_SECONDS returns the existing job (200, duplicate: true).
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @CurrentUser() user: UserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UploadResponse> {
    const started = Date.now();
    const { referenceId } = parseOrThrow(uploadFieldsSchema, body);
    if (!file || file.size === 0)
      throw new ApiError(400, 'VALIDATION_FAILED', 'A non-empty file is required');
    const ext = extensionOf(file.originalname);
    if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only PDF and DOCX files are supported');
    }
    const sniffed = sniffDocumentType(file.buffer);
    if (!sniffed || `.${sniffed}` !== ext) {
      throw new ApiError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'File content does not match a PDF or DOCX document',
      );
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const filename = file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 200);

    const out = await withTransaction(this.pool, async (c) => {
      if (!(await referencesRepo.referenceExists(c, referenceId))) {
        throw new ApiError(404, 'REFERENCE_NOT_FOUND', 'Reference document not found');
      }
      await documentsRepo.lockUploadKey(c, user.id, sha256);
      const dup = await documentsRepo.findRecentDuplicate(
        c,
        user.id,
        sha256,
        referenceId,
        this.config.duplicateWindowSeconds,
      );
      if (dup) return { ...dup, duplicate: true };
      const ids = await documentsRepo.insertUploadRecords(c, {
        ownerId: user.id,
        referenceId,
        filename,
        mimeType: sniffed === 'pdf' ? PDF_MIME : DOCX_MIME,
        sizeBytes: file.size,
        sha256,
        bytes: file.buffer,
        maxAttempts: this.config.maxJobAttempts,
      });
      if (this.faultHook) await this.faultHook(); // test seam: proves rollback of partial uploads
      return { ...ids, duplicate: false };
    });
    this.log.info(
      {
        event: out.duplicate ? 'upload.duplicate' : 'upload.accepted',
        user_id: user.id,
        document_id: out.documentId,
        job_id: out.jobId,
        size_bytes: file.size,
        type: sniffed,
        duration_ms: Date.now() - started,
      },
      out.duplicate ? 'duplicate upload; returning existing job' : 'upload accepted',
    );
    res.status(out.duplicate ? 200 : 202);
    return out;
  }

  @Get()
  list(@CurrentUser() user: UserDto): Promise<DocumentDto[]> {
    return documentsRepo.listDocumentsForOwner(this.pool, user.id);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: UserDto): Promise<DocumentDto> {
    const doc = await documentsRepo.getDocumentForOwner(
      this.pool,
      uuidParam(id, 'Document'),
      user.id,
    );
    if (!doc) throw ApiError.notFound('Document');
    return doc;
  }

  /** Inline PDF for the viewer (DOCX → converted preview); `?download=1` returns the original file. */
  @Get(':id/file')
  async file(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @CurrentUser() user: UserDto,
    @Res() res: Response,
  ): Promise<void> {
    const f = await documentsRepo.getDocumentFileForOwner(
      this.pool,
      uuidParam(id, 'Document'),
      user.id,
    );
    if (!f) throw ApiError.notFound('Document');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const safeName = encodeURIComponent(f.filename);
    if (download === '1') {
      res.setHeader('Content-Type', f.mime_type);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
      res.send(f.bytes);
      return;
    }
    const pdf = f.mime_type === PDF_MIME ? f.bytes : f.preview_pdf;
    if (!pdf)
      throw new ApiError(
        404,
        'NOT_FOUND',
        'Preview not available yet (document is still being converted)',
      );
    res.setHeader('Content-Type', PDF_MIME);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${safeName}`);
    res.send(pdf);
  }
}
