import { ActionOwnerGuard } from '../auth/guards/action-owner.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostIdPipe } from '../posts/pipes/post-id.pipe';
import { OptionalPostAuthGuard } from '../posts/guards/optional-post-auth.guard';
import { PostsJsonInterceptor } from '../posts/interceptors/posts-json.interceptor';
import { CommentsService } from './comments.service';
import {
  CommentPageDto,
  CreateCommentDto,
  RemoveContentDto,
} from './comments.dto';
@Controller()
@UseGuards(JwtAuthGuard, ActionOwnerGuard)
@UseInterceptors(PostsJsonInterceptor)
export class CommentsController {
  constructor(private readonly service: CommentsService) {}
  @Public()
  @UseGuards(OptionalPostAuthGuard)
  @Get('posts/:id/comments')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  list(
    @Param('id', PostIdPipe) id: bigint,
    @Query() query: CommentPageDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.list(id, query, user);
  }
  @Post('posts/:id/comments')
  create(
    @Param('id', PostIdPipe) id: bigint,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(id, dto, user);
  }
  @Delete('comments/:id')
  @HttpCode(204)
  remove(
    @Param('id', PostIdPipe) id: bigint,
    @Body() dto: RemoveContentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(id, dto, user);
  }
}
