import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { clientIdentity } from '../../common/security/client-identity';

/** Single-process limits; shared storage is required before horizontal scaling. */
@Injectable()
export class AuthRateLimitGuard implements CanActivate, OnModuleDestroy {
  constructor(private readonly config: ConfigService) {}
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
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const controller = context.getClass().name;
    // Infrastructure health probes carry no user operation and have their own network controls.
    if (controller === 'AppController' && request.method === 'GET') return true;
    const policy =
      controller === 'ModerationController' && operation === 'report'
        ? { limit: 10, duration: 3600000 }
        : controller === 'AuthController'
          ? this.policies[operation]
          : controller === 'PostsController' &&
              (operation === 'search' ||
                (operation === 'findPublicFeed' &&
                  request.query.q !== undefined))
            ? { limit: 30, duration: 60000 }
            : undefined;
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.until <= now) this.buckets.delete(key);
    }
    const identity = clientIdentity(
      request,
      this.config.get<string>('BFF_IDENTITY_SECRET'),
      now,
    );
    const policies = [
      { name: 'global', limit: 100, duration: 60000 },
      ...(policy
        ? [
            {
              name: controller === 'PostsController' ? 'search' : operation,
              ...policy,
            },
          ]
        : []),
    ];
    // Global applies first, including rejected specialized attempts. No async gap between checks.
    for (const current of policies) {
      const key = `${current.name}:${identity}`;
      const existing = this.buckets.get(key);
      if (
        (!existing && this.buckets.size >= 10000) ||
        (existing && existing.count >= current.limit)
      ) {
        response.setHeader(
          'Retry-After',
          Math.max(
            1,
            Math.ceil(((existing?.until ?? now + 60000) - now) / 1000),
          ),
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
        until: existing?.until ?? now + current.duration,
      });
    }
    return true;
  }

  onModuleDestroy(): void {
    this.buckets.clear();
  }
}
