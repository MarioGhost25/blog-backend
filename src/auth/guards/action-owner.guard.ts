import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../types/auth.types';
/** Fence a browser draft to the account that opened it, even if cookies changed. */
@Injectable()
export class ActionOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const owner = request.headers['x-post-owner'];
    if (
      request.method !== 'GET' &&
      owner !== undefined &&
      owner !== request.user?.id.toString()
    ) {
      throw new ForbiddenException({
        error: 'OperationOwnerChanged',
        message: 'The account changed; reopen the form',
      });
    }
    return true;
  }
}
