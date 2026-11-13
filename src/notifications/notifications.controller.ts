import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsJsonInterceptor } from '../posts/interceptors/posts-json.interceptor';
import { PostIdPipe } from '../posts/pipes/post-id.pipe';
import { parsePostId } from '../posts/utils/post-id';
import { NotificationsService } from './notifications.service';
class Filters {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @IsIn(['true', 'false']) unread?: string;
}
class ReadThrough {
  @IsString() throughId!: string;
}
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@UseInterceptors(PostsJsonInterceptor)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: Filters) {
    return this.service.list(
      user,
      query.cursor ? parsePostId(query.cursor) : undefined,
      query.unread === 'true',
    );
  }
  @Get('unread/count')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  async count(@CurrentUser() user: AuthenticatedUser) {
    return { count: await this.service.count(user) };
  }
  @Patch('read')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReadThrough) {
    return this.service.readThrough(user, parsePostId(dto.throughId));
  }
  @Patch(':id/read')
  @HttpCode(204)
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', PostIdPipe) id: bigint,
  ) {
    return this.service.read(user, id);
  }
}
