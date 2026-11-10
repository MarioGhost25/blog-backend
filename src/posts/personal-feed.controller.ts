import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { FilterPostsDto } from './dto/filter-posts.dto';
import { PostsService } from './posts.service';
import { PostsJsonInterceptor } from './interceptors/posts-json.interceptor';

@Controller('users/me/feed')
@UseGuards(JwtAuthGuard)
@UseInterceptors(PostsJsonInterceptor)
export class PersonalFeedController {
  constructor(private readonly posts: PostsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  find(@CurrentUser() user: AuthenticatedUser, @Query() query: FilterPostsDto) {
    return this.posts.findPersonalFeed(user, query);
  }
}
