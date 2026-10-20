import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UsuarioActual } from '../types/auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UsuarioActual => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: UsuarioActual }>();
    return request.user as UsuarioActual;
  },
);
