import type { EstadoUsuario, RolGlobal, EstadoContenido } from '@prisma/client';
import { ActionOwnerGuard } from '../auth/guards/action-owner.guard';
import {
  Controller,
  Body,
  Param,
  Patch,
  Delete,
  HttpCode,
  Get,
  Header,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  IsInt,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsJsonInterceptor } from '../posts/interceptors/posts-json.interceptor';
import { parsePostId } from '../posts/utils/post-id';
import { AdminService } from './admin.service';
class SummaryQuery {
  @IsOptional() @IsIn(['7', '30']) days?: string;
}
class UsersQuery {
  @IsOptional() @IsIn(['usuario', 'administrador']) role?: RolGlobal;
  @IsOptional() @IsIn(['activo', 'suspendido']) status?: EstadoUsuario;
  @IsOptional() @IsString() @MaxLength(254) q?: string;
  @IsOptional() @IsString() cursor?: string;
}
class SuspensionDto {
  @IsInt() @Min(1) @Max(90) days!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
class PostsQuery {
  @IsOptional() @IsString() @MaxLength(254) q?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional()
  @IsIn(['visible', 'retenido', 'eliminado'])
  status?: EstadoContenido;
  @IsOptional() @IsIn(['public', 'group']) scope?: string;
  @IsOptional() @IsString() categoryId?: string;
}
@Controller('admin')
@UseGuards(JwtAuthGuard, ActionOwnerGuard)
@UseInterceptors(PostsJsonInterceptor)
export class AdminController {
  constructor(private readonly service: AdminService) {}
  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SummaryQuery,
  ) {
    return this.service.summary(user, Number(query.days ?? 7));
  }
  @Get('users')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  users(@CurrentUser() user: AuthenticatedUser, @Query() query: UsersQuery) {
    return this.service.users(
      user,
      query.q?.trim(),
      query.cursor ? parsePostId(query.cursor) : undefined,
      query.role,
      query.status,
    );
  }
  @Patch('users/:id/suspension')
  @HttpCode(204)
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SuspensionDto,
  ) {
    return this.service.suspension(user, parsePostId(id), dto.days, dto.reason);
  }
  @Delete('users/:id/suspension')
  @HttpCode(204)
  reactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.suspension(user, parsePostId(id));
  }
  @Get('posts')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  posts(@CurrentUser() user: AuthenticatedUser, @Query() q: PostsQuery) {
    this.service.authorize(user);
    return this.service.posts(
      q.q,
      q.cursor ? parsePostId(q.cursor) : undefined,
      q.status,
      q.scope,
      q.categoryId ? parsePostId(q.categoryId) : undefined,
    );
  }
}
