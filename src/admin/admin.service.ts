import type { EstadoUsuario, RolGlobal, EstadoContenido } from '@prisma/client';
import { ForbiddenException, Injectable } from '@nestjs/common';
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
    return this.repository.suspension(id, user.id, days, reason);
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
