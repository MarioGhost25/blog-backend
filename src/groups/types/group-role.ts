import { RolGrupo } from '@prisma/client';

export enum GroupRole {
  Member = 'member',
  Moderator = 'moderator',
  Administrator = 'administrator',
}

export const databaseGroupRole: Record<GroupRole, RolGrupo> = {
  [GroupRole.Member]: RolGrupo.miembro,
  [GroupRole.Moderator]: RolGrupo.moderador,
  [GroupRole.Administrator]: RolGrupo.administrador,
};

export const apiGroupRole: Record<RolGrupo, GroupRole> = {
  [RolGrupo.miembro]: GroupRole.Member,
  [RolGrupo.moderador]: GroupRole.Moderator,
  [RolGrupo.administrador]: GroupRole.Administrator,
};
