import { PostStatus } from '../types/post-status';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class FilterMyPostsDto {
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @IsOptional()
  @IsString()
  cursor?: string;
}
