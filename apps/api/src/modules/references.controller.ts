import { referencesRepo, type pg } from '@mediverify/db';
import { PDF_MIME, type ReferenceDto } from '@mediverify/shared';
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ApiError } from '../common/api-error.js';
import { uuidParam } from '../common/zod.js';
import { PG_POOL } from '../tokens.js';

/** Reference documents are shared, read-only institutional sources (any authenticated user). */
@Controller('references')
export class ReferencesController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get()
  list(): Promise<ReferenceDto[]> {
    return referencesRepo.listReferences(this.pool);
  }

  @Get(':id/file')
  async file(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const f = await referencesRepo.getReferenceFile(this.pool, uuidParam(id, 'Reference'));
    if (!f) throw ApiError.notFound('Reference');
    res.setHeader('Content-Type', f.mime_type || PDF_MIME);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.bytes);
  }

  /** Citation preview: exact chunk text + monograph / section / field / page. */
  @Get(':id/chunks/:chunkId')
  async chunk(@Param('id') id: string, @Param('chunkId') chunkId: string) {
    const c = await referencesRepo.getChunkCitation(
      this.pool,
      uuidParam(id, 'Reference'),
      uuidParam(chunkId, 'Chunk'),
    );
    if (!c) throw ApiError.notFound('Chunk');
    return c;
  }
}
