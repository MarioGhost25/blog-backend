import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

@Controller('posts')
@UseGuards(JwtAuthGuard)
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
  findGroupFeed(
    @Param('groupId', PostIdPipe) groupId: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FilterPostsDto,
  ) {
    return this.posts.findGroupFeed(groupId, user, query);
  }

  @Public()
  @Get(':id')
  @UseGuards(OptionalPostAuthGuard)
  findOne(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.posts.findOne(id, user);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePostDto) {
    return this.posts.create(user, dto);
  }

  @Patch(':id')
  update(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePostDto,
  ) {
    return this.posts.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.posts.remove(id, user);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  addAttachment(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAttachmentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.attachments.addAttachment(id, user, dto, file);
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
