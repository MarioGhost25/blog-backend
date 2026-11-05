import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { CloudinaryService } from './cloudinary.service';

@Module({
  imports: [AuthModule, PrismaModule, ConfigModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, CloudinaryService],
  exports: [UsersService, UsersRepository, CloudinaryService],
})
export class UsersModule {}
