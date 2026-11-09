import { usersRepo, type pg } from '@mediverify/db';
import { credentialsSchema, SESSION_COOKIE, type UserDto } from '@mediverify/shared';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { CookieOptions, Response } from 'express';
import type { Logger } from 'pino';

import { ApiError } from '../common/api-error.js';
import {
  CurrentUser,
  hashToken,
  newSessionToken,
  Public,
  RateLimiter,
  type AuthedRequest,
} from '../common/auth.js';
import { parseOrThrow } from '../common/zod.js';
import type { AppConfig } from '../config.js';
import { APP_CONFIG, LOGGER, PG_POOL } from '../tokens.js';

// Unknown-email logins verify against a real dummy hash so they cost the same as wrong-password
// logins (no account enumeration via timing).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hash('not-a-real-password-placeholder'));

@Controller('auth')
export class AuthController {
  private readonly limiter = new RateLimiter(20, 60_000);

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly log: Logger,
  ) {}

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.secureCookies,
      path: '/',
      maxAge: this.config.sessionTtlSeconds * 1000,
    };
  }

  private async startSession(res: Response, user: UserDto) {
    const { token, hash: tokenHash } = newSessionToken();
    await usersRepo.createSession(this.pool, user.id, tokenHash, this.config.sessionTtlSeconds);
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
  }

  @Public()
  @Post('signup')
  @HttpCode(201)
  async signup(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    this.limiter.check(`signup:${req.ip}`);
    const { email, password } = parseOrThrow(credentialsSchema, body);
    const user = await usersRepo.createUser(this.pool, email, await hash(password));
    if (!user) throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    await this.startSession(res, user);
    this.log.info({ event: 'auth.signup', user_id: user.id }, 'user signed up');
    return user;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    this.limiter.check(`login:${req.ip}`);
    const { email, password } = parseOrThrow(credentialsSchema, body);
    const row = await usersRepo.findUserByEmail(this.pool, email);
    const ok = await verify(row?.password_hash ?? (await getDummyHash()), password).catch(
      () => false,
    );
    if (!row || !ok) {
      this.log.warn({ event: 'auth.login_failed' }, 'login failed');
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const user = { id: row.id, email: row.email };
    await this.startSession(res, user);
    this.log.info({ event: 'auth.login', user_id: user.id }, 'user logged in');
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) await usersRepo.revokeSession(this.pool, hashToken(token));
    res.clearCookie(SESSION_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  @Get('me')
  me(@CurrentUser() user: UserDto): UserDto {
    return user;
  }
}
