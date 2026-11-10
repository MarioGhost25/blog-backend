import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { AttachmentsService } from './attachments.service';
import { PostsRepository } from './posts.repository';
import { AttachmentsRepository } from './attachments.repository';
import { AttachmentStorageService } from './attachment-storage.service';
import { OptionalPostAuthGuard } from './guards/optional-post-auth.guard';
import { MediaCleanupService } from './media-cleanup.service';
import { PersonalFeedController } from './personal-feed.controller';

@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [PostsController, PersonalFeedController],
  providers: [
    PostsService,
    AttachmentsService,
    PostsRepository,
    AttachmentsRepository,
    AttachmentStorageService,
    MediaCleanupService,
    OptionalPostAuthGuard,
  ],
  exports: [PostsService, PostsRepository],
})
export class PostsModule {}
