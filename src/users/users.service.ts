import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { UsersRepository, UpdateProfileData } from './users.repository';
import { CloudinaryService } from './cloudinary.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { FilterMyPostsDto } from './dto/filter-my-posts.dto';
import { parseUserId } from './utils/user-id';
import { databasePostStatus } from './types/post-status';
import { MAX_PROFILE_PHOTO_BYTES } from './types/uploaded-image';
import type { UploadedImage } from './types/uploaded-image';

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async getMyProfile(userId: bigint) {
    const user = await this.repository.findProfileById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getPublicProfile(userId: bigint) {
    const user = await this.repository.findPublicProfileById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMyProfile(userId: bigint, dto: UpdateProfileDto) {
    const data: UpdateProfileData = {};
    for (const field of [
      'firstName',
      'lastName',
      'major',
      'university',
      'bio',
    ] as const) {
      const value = dto[field];
      if (value === undefined) continue;
      if (value === null) {
        if (field === 'firstName' || field === 'lastName') {
          throw new BadRequestException(`${field} cannot be null`);
        }
        data[field] = null;
        continue;
      }
      const clean = sanitizeHtml(value, {
        allowedTags: [],
        allowedAttributes: {},
      }).trim();
      const max = {
        firstName: 80,
        lastName: 80,
        major: 100,
        university: 120,
        bio: 500,
      }[field];
      if (
        clean.length > max ||
        ((field === 'firstName' || field === 'lastName') && clean.length < 2)
      ) {
        throw new BadRequestException(
          `${field} has an invalid length after removing HTML`,
        );
      }
      data[field] = clean;
    }
    await this.getMyProfile(userId);
    return this.repository.updateProfile(userId, data);
  }

  async updateMyPhoto(userId: bigint, file?: UploadedImage) {
    if (!file) throw new BadRequestException('You must attach an image');
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        'Only JPG or PNG images are allowed',
      );
    }
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      throw new PayloadTooLargeException('The image must not exceed 5 MB');
    }
    const user = await this.getMyProfile(userId);
    const uploaded = await this.cloudinary.uploadImage(file);
    let updated: Awaited<ReturnType<UsersRepository['updatePhoto']>>;
    try {
      updated = await this.repository.updatePhoto(
        userId,
        uploaded.url,
        uploaded.publicId,
      );
    } catch (error) {
      await this.cloudinary.deleteAsset(uploaded.publicId);
      throw error;
    }
    if (user.foto_public_id && user.foto_public_id !== uploaded.publicId) {
      await this.cloudinary.deleteAsset(user.foto_public_id);
    }
    return updated;
  }

  async getMyPosts(userId: bigint, query: FilterMyPostsDto) {
    const cursor =
      query.cursor == null ? undefined : parseUserId(query.cursor, 'cursor');
    const limit = 20;
    const rows = await this.repository.findMyPostsCursor(
      userId,
      query.status == null ? undefined : databasePostStatus[query.status],
      cursor,
      limit,
    );
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor:
        rows.length > limit
          ? items[items.length - 1].id_publicacion.toString()
          : null,
    };
  }
}
