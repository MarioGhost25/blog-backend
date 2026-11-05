import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { IsGroupId } from '../validators/is-group-id.validator';

export class MemberFiltersDto {
  @IsOptional() @IsString() q?: string;
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
