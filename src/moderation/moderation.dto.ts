import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { plainContent } from '../common/validation/content-text';
const clean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? plainContent(value) : value;
export class ReportDto {
  @IsOptional() @IsString() postId?: string;
  @IsOptional() @IsString() commentId?: string;
  @Transform(clean) @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class ModerationFilters {
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional()
  @IsIn([
    'pendiente',
    'desestimado',
    'contenido_retirado',
    'usuario_suspendido',
  ])
  status?: string;
  @IsOptional() @IsIn(['post', 'comment']) type?: 'post' | 'comment';
}
export class ResolveReportDto {
  @IsIn(['desestimado', 'contenido_retirado', 'usuario_suspendido']) decision!:
    'desestimado' | 'contenido_retirado' | 'usuario_suspendido';
  @Transform(clean)
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  observation!: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  suspensionDays?: number;
}
export class ReviewDto {
  @IsIn(['publish', 'remove']) decision!: 'publish' | 'remove';
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(1000)
  observation?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
}
