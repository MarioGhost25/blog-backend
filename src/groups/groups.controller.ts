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
import { RolGrupo } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { FilterGroupsDto, MemberFiltersDto } from './dto/filter-groups.dto';
import { ChangeGroupRoleDto } from './dto/change-group-role.dto';
import { TransferAdminDto } from './dto/transfer-admin.dto';
import { GroupIdPipe } from './group-id';
import { GroupRoles } from './group-roles.decorator';
import { GroupRoleGuard } from './group-role.guard';
import { GroupsJsonInterceptor } from './groups-json.interceptor';

@Controller('grupos')
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

  @Post(':id/miembros')
  join(
    @Param('id', GroupIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.joinGroup(id, user);
  }

  @Delete(':id/miembros/me')
  @HttpCode(204)
  leave(
    @Param('id', GroupIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.leaveGroup(id, user);
  }

  @Get(':id/miembros')
  @GroupRoles(RolGrupo.miembro)
  listMembers(
    @Param('id', GroupIdPipe) id: bigint,
    @Query() filters: MemberFiltersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listMembers(id, filters, user);
  }

  @Patch(':id/miembros/:idUsuario')
  @GroupRoles(RolGrupo.administrador)
  changeRole(
    @Param('id', GroupIdPipe) id: bigint,
    @Param('idUsuario', GroupIdPipe) userId: bigint,
    @Body() dto: ChangeGroupRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.changeMemberRole(id, userId, dto.rol, user);
  }

  @Delete(':id/miembros/:idUsuario')
  @GroupRoles(RolGrupo.administrador)
  @HttpCode(204)
  remove(
    @Param('id', GroupIdPipe) id: bigint,
    @Param('idUsuario', GroupIdPipe) userId: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeMemberByAdmin(id, userId, user);
  }

  @Post(':id/transferencia')
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
