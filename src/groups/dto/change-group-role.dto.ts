import { IsEnum } from 'class-validator';
import { GroupRole } from '../types/group-role';

export class ChangeGroupRoleDto {
  @IsEnum(GroupRole) role!: GroupRole;
}
