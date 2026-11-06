import {
  IsIn,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { AttachmentType } from '../types/posts.types';

export class CreateAttachmentDto {
  @IsIn(['image', 'document', 'link']) type!: AttachmentType;
  @IsString() @Length(1, 150) title!: string;
  @ValidateIf((value: CreateAttachmentDto) => value.type === 'link')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1024)
  url?: string;
}
