import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class FilterPostsDto {
  @IsOptional() @IsString() @MinLength(2) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() categoryId?: number;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
export class SearchPostsDto extends FilterPostsDto {}
