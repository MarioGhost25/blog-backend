import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ModerationRepository } from './moderation.repository';
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ModerationController],
  providers: [ModerationService, ModerationRepository],
})
export class ModerationModule {}
