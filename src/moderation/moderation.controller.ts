import { ActionOwnerGuard } from '../auth/guards/action-owner.guard';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsJsonInterceptor } from '../posts/interceptors/posts-json.interceptor';
import { PostIdPipe } from '../posts/pipes/post-id.pipe';
import { ModerationService } from './moderation.service';
import {
  ModerationFilters,
  ReportDto,
  ResolveReportDto,
  ReviewDto,
} from './moderation.dto';
@Controller()
@UseGuards(JwtAuthGuard, ActionOwnerGuard)
@UseInterceptors(PostsJsonInterceptor)
export class ModerationController {
  constructor(private readonly service: ModerationService) {}
  @Post('reports')
  report(@Body() dto: ReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.report(dto, user);
  }
  @Get('moderation/reports')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  reports(
    @Query() query: ModerationFilters,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reports(query, user);
  }
  @Get('moderation/reports/:id')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  detail(
    @Param('id', PostIdPipe) id: bigint,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.detail(id, user);
  }
  @Patch('moderation/reports/:id')
  @HttpCode(204)
  resolve(
    @Param('id', PostIdPipe) id: bigint,
    @Body() dto: ResolveReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.resolve(id, dto, user);
  }
  @Get('moderation/retained')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  retained(
    @Query() query: ModerationFilters,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.retained(query, user);
  }
  @Patch('moderation/retained/:type/:id')
  @HttpCode(204)
  review(
    @Param('type') type: string,
    @Param('id', PostIdPipe) id: bigint,
    @Body() dto: ReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.review(type, id, dto, user);
  }
}
