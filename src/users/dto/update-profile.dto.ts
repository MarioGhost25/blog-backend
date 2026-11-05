import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  major?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  university?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string | null;
}
