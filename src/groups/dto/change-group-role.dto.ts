import { IsEnum } from 'class-validator';
import { RolGrupo } from '@prisma/client';

export class ChangeGroupRoleDto {
  @IsEnum(RolGrupo) rol!: RolGrupo;
}
