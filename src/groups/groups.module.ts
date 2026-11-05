import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { GroupsRepository } from './groups.repository';
import { GroupRoleGuard } from './guards/group-role.guard';

@Module({
  imports: [AuthModule, CategoriesModule, PrismaModule],
  controllers: [GroupsController],
  providers: [GroupsService, GroupsRepository, GroupRoleGuard],
  exports: [GroupsService, GroupsRepository, GroupRoleGuard],
})
export class GroupsModule {}
