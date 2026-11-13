import type { Adjunto } from '@prisma/client';

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
    url:
      row.entrega === 'authenticated'
        ? `/api/v1/posts/${row.id_publicacion}/attachments/${row.id_adjunto}/content`
        : row.url,
    cloudinaryPublicId: row.cloudinary_public_id,
    delivery: row.entrega,
    mime: row.mime,
    order: row.orden,
  };
}
