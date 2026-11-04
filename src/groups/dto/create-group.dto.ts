import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { IsGroupId } from '../group-id';

export class CreateGroupDto {
  @IsString() @Length(3, 100) nombre!: string;
  @IsGroupId() idCategoria!: string | number;
  @IsOptional() @IsString() @MaxLength(1000) descripcion?: string;
}
