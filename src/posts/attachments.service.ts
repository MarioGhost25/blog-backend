import {
  BadRequestException,
  Injectable,
  GoneException,
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
import { validateMediaFile } from '../common/validation/media-file';
import { MediaCleanupService } from './media-cleanup.service';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly posts: PostsService,
    private readonly repository: AttachmentsRepository,
    private readonly storage: AttachmentStorageService,
    private readonly cleanup: MediaCleanupService,
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
    await validateMediaFile(file, dto.type);
    const publicId = await this.cleanup.begin(dto.type);
    await this.storage.upload(file, dto.type, publicId);
    // A pending intent is recoverable even if upload or the commit response is lost.
    return this.withAuthor(postId, user, async (repository) => {
      await repository.linkUpload(publicId);
      return repository.create({
        postId,
        type: dto.type,
        title: dto.title,
        url: '',
        cloudinaryPublicId: publicId,
        delivery: 'authenticated',
        mime: file.mimetype,
      });
    });
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
    if (attachment.cloudinaryPublicId)
      await this.cleanup.cleanup(attachment.cloudinaryPublicId);
  }

  async content(
    postId: bigint,
    attachmentId: bigint,
    user?: AuthenticatedUser,
  ) {
    const post = await this.posts.findOne(postId, user);
    const attachment = post.attachments.find(
      (item) => item.id === attachmentId,
    );
    if (!attachment || attachment.type === 'link')
      throw new NotFoundException();
    if (
      attachment.delivery !== 'authenticated' ||
      !attachment.cloudinaryPublicId ||
      !attachment.mime
    )
      throw new GoneException(
        'This legacy resource requires a private storage migration',
      );
    const buffer = await this.storage.read(
      attachment.cloudinaryPublicId,
      attachment.type,
      attachment.mime,
    );
    // Revocation/deletion during a slow provider request must take effect too.
    const current = await this.posts.findOne(postId, user);
    if (!current.attachments.some((item) => item.id === attachmentId))
      throw new NotFoundException();
    return { buffer, mime: attachment.mime, type: attachment.type };
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
