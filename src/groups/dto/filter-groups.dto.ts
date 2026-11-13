import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsGroupId } from '../validators/is-group-id.validator';
import { normalizeSearch } from '../../common/validation/normalize-name';

export class MemberFiltersDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeSearch(value))
  @IsString()
  @MaxLength(254)
  q?: string;
  @IsOptional() @IsString() @IsGroupId() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class FilterGroupsDto extends MemberFiltersDto {
  @IsOptional() @IsGroupId() categoryId?: string | number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  mine?: boolean;
}
