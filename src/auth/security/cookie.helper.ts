import type { CookieOptions, Request, Response } from 'express';

const JWT_COOKIE_NAME = 'jwt';

function jwtCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
}

export function setJwtCookie(res: Response, token: string): void {
  res.cookie(JWT_COOKIE_NAME, token, {
    ...jwtCookieOptions(),
    maxAge: 60 * 60 * 1000,
  });
}

export function clearJwtCookie(res: Response): void {
  res.clearCookie(JWT_COOKIE_NAME, jwtCookieOptions());
}

export function extractJwtFromCookie(req: Request): string | null {
  const request: { cookies?: Record<string, unknown> } = req;
  const token = request?.cookies?.[JWT_COOKIE_NAME] ?? null;
  return typeof token === 'string' ? token : null;
}
