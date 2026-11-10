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
    url: row.url,
    cloudinaryPublicId: row.cloudinary_public_id,
    order: row.orden,
  };
}
