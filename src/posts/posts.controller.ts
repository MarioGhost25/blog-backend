import { ActionOwnerGuard } from '../auth/guards/action-owner.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RemoveContentDto } from '../comments/comments.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsService } from './posts.service';
import { AttachmentsService } from './attachments.service';
import { PostIdPipe } from './pipes/post-id.pipe';
import { OptionalPostAuthGuard } from './guards/optional-post-auth.guard';
import { PostsJsonInterceptor } from './interceptors/posts-json.interceptor';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { FilterPostsDto, SearchPostsDto } from './dto/filter-posts.dto';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { ReorderAttachmentsDto } from './dto/reorder-attachments.dto';
import type { UploadedAttachment } from './types/uploaded-attachment';

@Controller('posts')
@UseGuards(JwtAuthGuard, ActionOwnerGuard)
@UseInterceptors(PostsJsonInterceptor)
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Public()
  @Get()
  findPublicFeed(@Query() query: FilterPostsDto) {
    return this.posts.findPublicFeed(query);
  }

  @Public()
  @Get('search')
  search(@Query() query: SearchPostsDto) {
    return this.posts.search(query);
  }

  @Get('group/:groupId')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  findGroupFeed(
    @Param('groupId', PostIdPipe) groupId: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FilterPostsDto,
  ) {
    return this.posts.findGroupFeed(groupId, user, query);
  }

  @Public()
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  @UseGuards(OptionalPostAuthGuard)
  findOne(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.posts.findOne(id, user);
  }

  @Get('operations/:key')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  getOperation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Headers('x-post-owner') owner?: string,
  ) {
    return this.posts.getOperation(user, key, owner);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePostDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-post-owner') owner?: string,
  ) {
    if (key !== undefined)
      return this.posts.writeOperation(
        user,
        key,
        owner,
        'POST',
        undefined,
        dto,
      );
    return this.posts.create(user, dto);
  }

  @Patch(':id')
  update(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePostDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-post-owner') owner?: string,
  ) {
    if (key !== undefined)
      return this.posts.writeOperation(user, key, owner, 'PATCH', id, dto);
    return this.posts.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RemoveContentDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-post-owner') owner?: string,
  ) {
    if (key !== undefined)
      return this.posts.writeOperation(user, key, owner, 'DELETE', id);
    return this.posts.remove(id, user, dto?.observation);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
        fields: 3,
        fieldSize: 4096,
        parts: 4,
        fieldNameSize: 80,
      },
    }),
  )
  addAttachment(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAttachmentDto,
    @UploadedFile() file?: UploadedAttachment,
  ) {
    return this.attachments.addAttachment(id, user, dto, file);
  }

  @Public()
  @UseGuards(OptionalPostAuthGuard)
  @Get(':id/attachments/:attachmentId/content')
  async attachmentContent(
    @Param('id', PostIdPipe) id: bigint,
    @Param('attachmentId', PostIdPipe) attachmentId: bigint,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res() response: Response,
  ) {
    const file = await this.attachments.content(id, attachmentId, user);
    response
      .set({
        'Content-Type': file.mime,
        'Content-Length': String(file.buffer.length),
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition':
          file.type === 'document'
            ? 'attachment; filename="recurso.pdf"'
            : 'inline',
      })
      .send(file.buffer);
  }

  @Patch(':id/attachments/order')
  reorder(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderAttachmentsDto,
  ) {
    return this.attachments.reorder(id, user, dto);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAttachment(
    @Param('id', PostIdPipe) id: bigint,
    @Param('attachmentId', PostIdPipe) attachmentId: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.remove(id, attachmentId, user);
  }
}
