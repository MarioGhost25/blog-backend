import {
  IsDefined,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdatePostDto {
  @IsOptional() @IsString() @Length(3, 150) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20000) content?: string;
  @IsOptional() @IsInt() @IsPositive() categoryId?: number;
  @IsDefined({
    message:
      'version is required. Get the post with GET /posts/:id and send its current version.',
  })
  @IsInt()
  @Min(1)
  version!: number;
}
