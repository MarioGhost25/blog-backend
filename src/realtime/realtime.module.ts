import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PostsModule } from '../posts/posts.module';
import { RealtimeGateway } from './realtime.gateway';
@Module({
  imports: [AuthModule, PrismaModule, PostsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
