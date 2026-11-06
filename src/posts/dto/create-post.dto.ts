import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePostDto {
  @IsString() @Length(3, 150) title!: string;
  @IsString() @MinLength(1) @MaxLength(20000) content!: string;
  @IsInt() @IsPositive() categoryId!: number;
  @IsOptional() @IsInt() @IsPositive() groupId?: number;
}
