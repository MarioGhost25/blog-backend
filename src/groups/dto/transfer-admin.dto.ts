import { IsBoolean } from 'class-validator';
import { IsGroupId } from '../group-id';

export class TransferAdminDto {
  @IsGroupId() idNuevoAdministrador!: string | number;
  @IsBoolean() salir!: boolean;
}
