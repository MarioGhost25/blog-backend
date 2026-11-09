import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Single-process limits; shared storage is required before horizontal scaling. */
@Injectable()
export class AuthRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  private readonly policies: Record<
    string,
    { limit: number; duration: number }
  > = {
    register: { limit: 5, duration: 60000 },
    login: { limit: 5, duration: 60000 },
    forgotPassword: { limit: 3, duration: 3600000 },
    resetPassword: { limit: 5, duration: 60000 },
  };

  canActivate(context: ExecutionContext): boolean {
    const operation = context.getHandler().name;
    const policy = this.policies[operation];
    if (!policy) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.until <= now) this.buckets.delete(key);
    }
    // Do not trust an arbitrary X-Forwarded-For header from the caller.
    const key = `${operation}:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`;
    const existing = this.buckets.get(key);
    if (
      (!existing && this.buckets.size >= 10000) ||
      (existing && existing.count >= policy.limit)
    ) {
      response.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil(((existing?.until ?? now + 60000) - now) / 1000)),
      );
      throw new HttpException(
        {
          statusCode: 429,
          error: 'RateLimited',
          message: 'Too many attempts. Try again later.',
        },
        429,
      );
    }
    this.buckets.set(key, {
      count: (existing?.count ?? 0) + 1,
      until: existing?.until ?? now + policy.duration,
    });
    return true;
  }

  onModuleDestroy(): void {
    this.buckets.clear();
  }
}
