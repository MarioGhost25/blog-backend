import { RealtimeModule } from './realtime/realtime.module';
import { ModerationModule } from './moderation/moderation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CommentsModule } from './comments/comments.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { joiValidationSchema } from './config/joi.validation';
import { CategoriesModule } from './categories/categories.module';
import { GroupsModule } from './groups/groups.module';
import { UsersModule } from './users/users.module';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: joiValidationSchema,
    }),
    AuthModule,
    CategoriesModule,
    GroupsModule,
    UsersModule,
    PostsModule,
    CommentsModule,
    NotificationsModule,
    ModerationModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
