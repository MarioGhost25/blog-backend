import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { normalizeSearch } from '../../common/validation/normalize-name';

export class FilterPostsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeSearch(value))
  @IsString()
  @MinLength(2)
  @MaxLength(254)
  q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() categoryId?: number;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
export class SearchPostsDto extends FilterPostsDto {}
