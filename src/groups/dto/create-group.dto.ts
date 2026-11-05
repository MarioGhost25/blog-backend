import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { IsGroupId } from '../validators/is-group-id.validator';

export class CreateGroupDto {
  @IsString()
  @Length(3, 100)
  name!: string;
  @IsGroupId({
    message:
      '$property must be a positive integer ID, for example "1" (maximum 9223372036854775807)',
  })
  categoryId!: string | number;
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
