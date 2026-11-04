import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolGlobal, RolGrupo } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { GroupsRepository } from './groups.repository';
import { GROUP_ROLES } from './group-roles.decorator';
import { parseGroupId } from './group-id';

@Injectable()
export class GroupRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly repository: GroupsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<RolGrupo[]>(GROUP_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ params: { id: string }; user?: AuthenticatedUser }>();
    const groupId = parseGroupId(request.params.id);
    if (!request.user) throw new ForbiddenException();
    if (request.user.role === RolGlobal.administrador) return true;
    const membership = await this.repository.findMembership(
      groupId,
      request.user.id,
    );
    const rank: Record<RolGrupo, number> = {
      miembro: 0,
      moderador: 1,
      administrador: 2,
    };
    if (
      !membership ||
      rank[membership.rol] < Math.min(...roles.map((role) => rank[role]))
    )
      throw new ForbiddenException();
    return true;
  }
}
