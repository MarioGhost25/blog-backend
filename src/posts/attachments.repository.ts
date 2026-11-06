import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Adjunto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AttachmentWrite } from './types/posts.types';

const databaseTypes = {
  image: 'imagen',
  document: 'documento',
  link: 'enlace',
} as const;
const domainTypes = {
  imagen: 'image',
  documento: 'document',
  enlace: 'link',
} as const;
export function mapAttachment(row: Adjunto) {
  return {
    id: row.id_adjunto,
    postId: row.id_publicacion,
    type: domainTypes[row.tipo],
    title: row.titulo,
    url: row.url,
    cloudinaryPublicId: row.cloudinary_public_id,
    order: row.orden,
  };
}

@Injectable()
export class AttachmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async nextOrder(postId: bigint) {
    const result = await this.prisma.adjunto.aggregate({
      where: { id_publicacion: postId },
      _max: { orden: true },
    });
    return (result._max.orden ?? 0) + 1;
  }

  async create(data: AttachmentWrite) {
    // Serialize attachment mutations on their parent, including order allocation.
    return this.prisma.$transaction(async (tx) => {
      await this.lockPost(tx, data.postId);
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
            orden: (maximum._max.orden ?? 0) + 1,
          },
        }),
      );
    });
  }

  async findById(attachmentId: bigint) {
    const row = await this.prisma.adjunto.findUnique({
      where: { id_adjunto: attachmentId },
    });
    return row ? mapAttachment(row) : null;
  }

  async findByPostId(postId: bigint) {
    return (
      await this.prisma.adjunto.findMany({
        where: { id_publicacion: postId },
        orderBy: { orden: 'asc' },
      })
    ).map(mapAttachment);
  }

  async reorder(postId: bigint, orderedIds: bigint[]) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPost(tx, postId);
      const rows = await tx.adjunto.findMany({
        where: { id_publicacion: postId },
      });
      if (
        orderedIds.length !== rows.length ||
        new Set(orderedIds).size !== rows.length ||
        rows.some((row) => !orderedIds.includes(row.id_adjunto))
      ) {
        throw new BadRequestException(
          'Provide every attachment ID exactly once',
        );
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
    });
  }

  async delete(attachmentId: bigint) {
    const attachment = await this.findById(attachmentId);
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.prisma.$transaction(async (tx) => {
      await this.lockPost(tx, attachment.postId);
      await tx.adjunto.deleteMany({ where: { id_adjunto: attachmentId } });
    });
  }

  private async lockPost(tx: Prisma.TransactionClient, postId: bigint) {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id_publicacion AS id FROM publicacion
      WHERE id_publicacion = ${postId} AND estado != 'eliminado' FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Post not found');
  }
}
