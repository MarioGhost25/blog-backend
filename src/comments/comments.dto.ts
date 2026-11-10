import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { plainContent } from '../common/validation/content-text';
export class CommentPageDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
export class CreateCommentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? plainContent(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
  @IsOptional() @IsString() parentCommentId?: string;
}
export class RemoveContentDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? plainContent(value) : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  observation?: string;
}
