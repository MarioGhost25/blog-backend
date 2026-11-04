import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { IsGroupId } from '../group-id';

export class MemberFiltersDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() @IsGroupId() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limite?: number;
}

export class FilterGroupsDto extends MemberFiltersDto {
  @IsOptional() @IsGroupId() categoria?: string | number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  mios?: boolean;
}
