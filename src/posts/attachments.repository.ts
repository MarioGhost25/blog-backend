import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AttachmentWrite } from './types/posts.types';
import { lockPostHierarchy } from '../common/database/content-locks';
import { PostsRepository } from './posts.repository';
import { mapAttachment } from './mappers/attachment';

const databaseTypes = {
  image: 'imagen',
  document: 'documento',
  link: 'enlace',
} as const;
@Injectable()
export class AttachmentsRepository {
  constructor(private readonly prisma: PrismaService) {}
  private transaction?: Prisma.TransactionClient;
  private get db() {
    return this.transaction ?? this.prisma;
  }
  private get writer() {
    if (!this.transaction)
      throw new Error(
        'Attachment writes require the authorized parent transaction',
      );
    return this.transaction;
  }

  withPostLock<T>(
    postId: bigint,
    work: (
      repository: AttachmentsRepository,
      posts: PostsRepository,
    ) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockPostHierarchy(tx, postId);
        const scoped = new AttachmentsRepository(this.prisma);
        scoped.transaction = tx;
        return work(scoped, new PostsRepository(this.prisma).inTransaction(tx));
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 10000,
      },
    );
  }

  async create(data: AttachmentWrite) {
    const tx = this.writer;
    const maximum = await tx.adjunto.aggregate({
      where: { id_publicacion: data.postId },
      _max: { orden: true },
    });
    return mapAttachment(
      await tx.adjunto.create({
        data: {
          id_publicacion: data.postId,
          tipo: databaseTypes[data.type],
          titulo: data.title,
          url: data.url,
          cloudinary_public_id: data.cloudinaryPublicId,
          entrega: data.delivery ?? 'upload',
          mime: data.mime,
          orden: (maximum._max.orden ?? 0) + 1,
        },
      }),
    );
  }

  async findById(attachmentId: bigint) {
    const row = await this.db.adjunto.findUnique({
      where: { id_adjunto: attachmentId },
    });
    return row ? mapAttachment(row) : null;
  }

  async findByPostId(postId: bigint) {
    return (
      await this.db.adjunto.findMany({
        where: { id_publicacion: postId },
        orderBy: { orden: 'asc' },
      })
    ).map(mapAttachment);
  }

  async reorder(postId: bigint, orderedIds: bigint[]) {
    const tx = this.writer;
    const rows = await tx.adjunto.findMany({
      where: { id_publicacion: postId },
    });
    if (
      !orderedIds.length ||
      orderedIds.length !== rows.length ||
      new Set(orderedIds).size !== rows.length ||
      rows.some((row) => !orderedIds.includes(row.id_adjunto))
    ) {
      throw new BadRequestException('Provide every attachment ID exactly once');
    }
    const offset = Math.max(0, ...rows.map((row) => row.orden));
    for (const [index, id] of orderedIds.entries()) {
      await tx.adjunto.update({
        where: { id_adjunto: id },
        data: { orden: offset + index + 1 },
      });
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx.adjunto.update({
        where: { id_adjunto: id },
        data: { orden: index + 1 },
      });
    }
    return (
      await tx.adjunto.findMany({
        where: { id_publicacion: postId },
        orderBy: { orden: 'asc' },
      })
    ).map(mapAttachment);
  }

  async delete(attachmentId: bigint) {
    const attachment = await this.findById(attachmentId);
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.writer.adjunto.delete({ where: { id_adjunto: attachmentId } });
    if (attachment.cloudinaryPublicId && attachment.type !== 'link') {
      const data = {
        tipo: attachment.type,
        entrega: attachment.delivery,
        estado: 'deleting',
        siguiente_intento: new Date(),
      };
      await this.writer.activoMultimedia.upsert({
        where: { public_id: attachment.cloudinaryPublicId },
        create: { public_id: attachment.cloudinaryPublicId, ...data },
        update: data,
      });
    }
    return attachment;
  }

  async linkUpload(publicId: string) {
    const result = await this.writer.activoMultimedia.updateMany({
      where: {
        public_id: publicId,
        estado: 'pending',
        siguiente_intento: { gt: new Date() },
      },
      data: { estado: 'linked' },
    });
    if (result.count !== 1)
      throw new BadRequestException('Upload expired; please try again');
  }
}
