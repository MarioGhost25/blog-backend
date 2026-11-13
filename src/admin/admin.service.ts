import type { EstadoUsuario, RolGlobal, EstadoContenido } from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { AdminRepository } from './admin.repository';
@Injectable()
export class AdminService {
  constructor(private readonly repository: AdminRepository) {}
  authorize(user: AuthenticatedUser) {
    if (user.role !== 'administrador') throw new ForbiddenException();
  }
  summary(user: AuthenticatedUser, days: number) {
    this.authorize(user);
    return this.repository.summary(days);
  }
  users(
    user: AuthenticatedUser,
    q?: string,
    cursor?: bigint,
    role?: RolGlobal,
    status?: EstadoUsuario,
  ) {
    this.authorize(user);
    return this.repository.users(q, cursor, role, status);
  }
  suspension(
    user: AuthenticatedUser,
    id: bigint,
    days?: number,
    reason?: string,
  ) {
    this.authorize(user);
    if (id === user.id)
      throw new BadRequestException('Cannot change your own suspension');
    if (
      days !== undefined &&
      (!Number.isInteger(days) ||
        days < 1 ||
        days > 90 ||
        !reason ||
        reason.trim().length < 5 ||
        reason.length > 500)
    )
      throw new BadRequestException(
        'Suspension requires 1–90 days and a reason of 5–500 characters',
      );
    return this.repository.updateSuspension(
      id,
      user.id,
      days === undefined
        ? {
            estado: 'activo',
            suspendido_hasta: null,
            motivo_suspension: null,
            suspendido_por: null,
          }
        : {
            estado: 'suspendido',
            suspendido_hasta: new Date(Date.now() + days * 86400000),
            motivo_suspension: reason!,
            suspendido_por: user.id,
          },
      (current) => {
        if (current?.rol !== 'administrador' || current.estado !== 'activo')
          throw new ForbiddenException();
      },
    );
  }
  posts(
    q?: string,
    cursor?: bigint,
    status?: EstadoContenido,
    scope?: string,
    categoryId?: bigint,
  ) {
    return this.repository.posts(q, cursor, status, scope, categoryId);
  }
}
