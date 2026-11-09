import { createHash, randomBytes } from 'node:crypto';

import { usersRepo, type pg } from '@mediverify/db';
import { SESSION_COOKIE, type UserDto } from '@mediverify/shared';
import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AppConfig } from '../config.js';
import { APP_CONFIG, PG_POOL } from '../tokens.js';

import { ApiError } from './api-error.js';

export interface AuthedRequest extends Request {
  user?: UserDto;
}

const IS_PUBLIC = 'mv:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserDto => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw ApiError.unauthenticated();
  return req.user;
});

export function newSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Global guard: every route requires a valid session unless marked @Public().
 * Mutating requests must also come from an allowed Origin (CSRF defence-in-depth on top of
 * SameSite=Strict cookies).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !this.config.allowedOrigins.includes(origin)) {
        throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'Request origin not allowed');
      }
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) {
      const user = await usersRepo.findSessionUser(this.pool, hashToken(token));
      if (user) req.user = user;
    }
    if (isPublic) return true;
    if (!req.user) throw ApiError.unauthenticated();
    return true;
  }
}

/** Tiny fixed-window limiter for auth endpoints (per IP); enough to blunt credential stuffing in a demo. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  check(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    h.count++;
    if (h.count > this.limit)
      throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts; try again shortly');
  }
}
