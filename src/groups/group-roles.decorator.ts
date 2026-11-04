import { SetMetadata } from '@nestjs/common';
import { RolGrupo } from '@prisma/client';

export const GROUP_ROLES = 'groupRoles';
export const GroupRoles = (...roles: RolGrupo[]) =>
  SetMetadata(GROUP_ROLES, roles);
