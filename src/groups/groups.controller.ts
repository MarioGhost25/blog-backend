import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { databaseGroupRole } from './types/group-role';
import { RolGrupo } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { FilterGroupsDto, MemberFiltersDto } from './dto/filter-groups.dto';
import { ChangeGroupRoleDto } from './dto/change-group-role.dto';
import { TransferAdminDto } from './dto/transfer-admin.dto';
import { GroupIdPipe } from './pipes/group-id.pipe';
import { GroupRoles } from './decorators/group-roles.decorator';
import { GroupRoleGuard } from './guards/group-role.guard';
import { GroupsJsonInterceptor } from './interceptors/groups-json.interceptor';

@Controller('groups')
@UseGuards(JwtAuthGuard, GroupRoleGuard)
@UseInterceptors(GroupsJsonInterceptor)
export class GroupsController {
  constructor(private readonly service: GroupsService) {}

  @Post()
  create(@Body() dto: CreateGroupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Get()
  findAll(
    @Query() filters: FilterGroupsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(filters, user);
  }

  @Get(':id')
  findOne(
    @Param('id', GroupIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(id, user);
  }

  @Post(':id/members')
  join(
    @Param('id', GroupIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.joinGroup(id, user);
  }

  @Delete(':id/members/me')
  @HttpCode(204)
  leave(
    @Param('id', GroupIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.leaveGroup(id, user);
  }

  @Get(':id/members')
  @GroupRoles(RolGrupo.miembro)
  listMembers(
    @Param('id', GroupIdPipe) id: bigint,
    @Query() filters: MemberFiltersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listMembers(id, filters, user);
  }

  @Patch(':id/members/:userId')
  @GroupRoles(RolGrupo.administrador)
  changeRole(
    @Param('id', GroupIdPipe) id: bigint,
    @Param('userId', GroupIdPipe) userId: bigint,
    @Body() dto: ChangeGroupRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.changeMemberRole(
      id,
      userId,
      databaseGroupRole[dto.role],
      user,
    );
  }

  @Delete(':id/members/:userId')
  @GroupRoles(RolGrupo.administrador)
  @HttpCode(204)
  remove(
    @Param('id', GroupIdPipe) id: bigint,
    @Param('userId', GroupIdPipe) userId: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeMemberByAdmin(id, userId, user);
  }

  @Post(':id/transfer')
  @GroupRoles(RolGrupo.administrador)
  @HttpCode(204)
  transfer(
    @Param('id', GroupIdPipe) id: bigint,
    @Body() dto: TransferAdminDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.transferAdministration(id, dto, user);
  }
}
