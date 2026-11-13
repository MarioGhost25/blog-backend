import { PostsModule } from '../posts/posts.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OptionalPostAuthGuard } from '../posts/guards/optional-post-auth.guard';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentsRepository } from './comments.repository';
@Module({
  imports: [AuthModule, PrismaModule, PostsModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentsRepository, OptionalPostAuthGuard],
})
export class CommentsModule {}
