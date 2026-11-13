import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { FilterMyPostsDto } from './dto/filter-my-posts.dto';
import { UsersJsonInterceptor } from './interceptors/users-json.interceptor';
import { parseUserId } from './utils/user-id';
import { MAX_PROFILE_PHOTO_BYTES } from './types/uploaded-image';
import type { UploadedImage } from './types/uploaded-image';

@Controller('users')
@UseGuards(JwtAuthGuard)
@UseInterceptors(UsersJsonInterceptor)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyProfile(user.id);
  }

  @Patch('me')
  updateMyProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.service.updateMyProfile(user.id, dto);
  }

  @Put('me/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      // Multer rejects at the threshold; allow exactly 5 MB.
      limits: { fileSize: MAX_PROFILE_PHOTO_BYTES + 1 },
    }),
  )
  updateMyPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedImage,
  ) {
    return this.service.updateMyPhoto(user.id, file);
  }

  @Get('me/posts')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  getMyPosts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FilterMyPostsDto,
  ) {
    return this.service.getMyPosts(user.id, query);
  }

  @Public()
  @Get(':id')
  getPublicProfile(@Param('id') id: string) {
    return this.service.getPublicProfile(parseUserId(id));
  }
}
