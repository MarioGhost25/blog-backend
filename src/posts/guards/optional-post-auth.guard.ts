import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { extractJwtFromCookie } from '../../auth/security/cookie.helper';

@Injectable()
export class OptionalPostAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!extractJwtFromCookie(request)) return true;
    return super.canActivate(context);
  }
}
