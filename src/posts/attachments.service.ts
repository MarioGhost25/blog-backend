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
    // Cheap preflight before contacting a provider. The same policy is checked
    // again under group -> post locks before linking the uploaded asset.
    await this.posts.requireAuthor(postId, user);
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
      const url = dto.url;
      return this.withAuthor(postId, user, (repository) =>
        repository.create({
          postId,
          type: dto.type,
          title: dto.title,
          url,
          cloudinaryPublicId: null,
        }),
      );
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
      return await this.withAuthor(postId, user, (repository) =>
        repository.create({
          postId,
          type: dto.type,
          title: dto.title,
          url: asset.url,
          cloudinaryPublicId: asset.publicId,
        }),
      );
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
    const ids = dto.attachmentIds.map(parsePostId);
    return this.withAuthor(postId, user, (repository) =>
      repository.reorder(postId, ids),
    );
  }

  async remove(postId: bigint, attachmentId: bigint, user: AuthenticatedUser) {
    const attachment = await this.withAuthor(
      postId,
      user,
      async (repository) => {
        const current = await repository.findById(attachmentId);
        if (!current || current.postId !== postId)
          throw new NotFoundException('Attachment not found');
        return repository.delete(attachmentId);
      },
    );
    // The authorized DB deletion is the commit point. Never delete the provider
    // asset before current membership has been checked and the unlink committed.
    // Provider failures still surface as 502; reloading shows the committed DB
    // state. Durable provider cleanup remains part of A02.
    if (attachment.cloudinaryPublicId)
      await this.storage.delete(attachment.cloudinaryPublicId, attachment.type);
  }

  private withAuthor<T>(
    postId: bigint,
    user: AuthenticatedUser,
    work: (repository: AttachmentsRepository) => Promise<T>,
  ) {
    return this.repository.withPostLock(postId, async (repository, posts) => {
      await new PostsService(posts).requireAuthor(postId, user);
      return work(repository);
    });
  }
}
