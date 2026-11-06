import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { isURL } from 'class-validator';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsService } from './posts.service';
import { AttachmentsRepository } from './attachments.repository';
import { AttachmentStorageService } from './attachment-storage.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { ReorderAttachmentsDto } from './dto/reorder-attachments.dto';
import { parsePostId } from './utils/post-id';
import type { UploadedAttachment } from './types/uploaded-attachment';

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  constructor(
    private readonly posts: PostsService,
    private readonly repository: AttachmentsRepository,
    private readonly storage: AttachmentStorageService,
  ) {}

  async addAttachment(
    postId: bigint,
    user: AuthenticatedUser,
    dto: CreateAttachmentDto,
    file?: UploadedAttachment,
  ) {
    await this.posts.requireAuthor(postId, user);
    const order = await this.repository.nextOrder(postId);
    if (dto.type === 'link') {
      if (
        !dto.url ||
        !isURL(dto.url, {
          protocols: ['http', 'https'],
          require_protocol: true,
        }) ||
        dto.url.length > 1024
      ) {
        throw new BadRequestException('A valid HTTP or HTTPS URL is required');
      }
      return this.repository.create({
        postId,
        type: dto.type,
        title: dto.title,
        url: dto.url,
        cloudinaryPublicId: null,
        order,
      });
    }
    if (!file) throw new BadRequestException('A file is required');
    if (file.size > 10 * 1024 * 1024 || file.buffer.length > 10 * 1024 * 1024)
      throw new PayloadTooLargeException('The file exceeds 10 MB');
    const allowed =
      dto.type === 'image' ? ['image/jpeg', 'image/png'] : ['application/pdf'];
    if (!allowed.includes(file.mimetype))
      throw new UnsupportedMediaTypeException(
        'The file type does not match the attachment type',
      );
    const asset = await this.storage.upload(file, dto.type);
    try {
      return await this.repository.create({
        postId,
        type: dto.type,
        title: dto.title,
        url: asset.url,
        cloudinaryPublicId: asset.publicId,
        order,
      });
    } catch (error) {
      try {
        await this.storage.delete(asset.publicId, dto.type);
      } catch {
        this.logger.error(
          'Could not clean up an attachment after a database failure',
        );
      }
      throw error;
    }
  }

  async reorder(
    postId: bigint,
    user: AuthenticatedUser,
    dto: ReorderAttachmentsDto,
  ) {
    await this.posts.requireAuthor(postId, user);
    const ids = dto.attachmentIds.map(parsePostId);
    const attachments = await this.repository.findByPostId(postId);
    if (
      !ids.length ||
      ids.length !== attachments.length ||
      new Set(ids).size !== ids.length ||
      attachments.some((attachment) => !ids.includes(attachment.id))
    ) {
      throw new BadRequestException('Provide every attachment ID exactly once');
    }
    return this.repository.reorder(postId, ids);
  }

  async remove(postId: bigint, attachmentId: bigint, user: AuthenticatedUser) {
    await this.posts.requireAuthor(postId, user);
    const attachment = await this.repository.findById(attachmentId);
    if (!attachment || attachment.postId !== postId)
      throw new NotFoundException('Attachment not found');
    if (attachment.cloudinaryPublicId)
      await this.storage.delete(attachment.cloudinaryPublicId, attachment.type);
    await this.repository.delete(attachmentId);
  }
}
