import { IsBoolean } from 'class-validator';
import { IsGroupId } from '../validators/is-group-id.validator';

export class TransferAdminDto {
  @IsGroupId() newAdministratorId!: string | number;
  @IsBoolean({
    message:
      'leave must be a boolean: true to leave the group, or false to remain as a member (without quotes)',
  })
  leave!: boolean;
}
