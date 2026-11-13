import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type ContentLock = 'read' | 'write';

/** All membership/content writers acquire group -> post -> dependent rows.
 * Read locks allow simultaneous readers but serialize with membership revocation.
 * Provider calls must remain outside these transactions. */
export async function lockGroup(
  tx: Prisma.TransactionClient,
  groupId: bigint,
  mode: ContentLock = 'write',
) {
  const rows = await tx.$queryRaw<{ id_grupo: bigint }[]>(Prisma.sql`
    SELECT id_grupo FROM grupo_estudio WHERE id_grupo = ${groupId}
    ${mode === 'read' ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`);
  if (!rows.length) throw new NotFoundException('Group not found');
}

export async function lockPostHierarchy(
  tx: Prisma.TransactionClient,
  postId: bigint,
  mode: ContentLock = 'write',
  allowDeleted = false,
) {
  // The API never changes a post's group. Check again under the lock so a future
  // move implementation cannot silently violate the lock order.
  const initial = await tx.publicacion.findUnique({
    where: { id_publicacion: postId },
    select: { id_grupo: true },
  });
  if (!initial) throw new NotFoundException('Post not found');
  if (initial.id_grupo !== null) await lockGroup(tx, initial.id_grupo, mode);
  const rows = await tx.$queryRaw<
    { id_grupo: bigint | null; estado: string }[]
  >(Prisma.sql`
    SELECT id_grupo, estado FROM publicacion WHERE id_publicacion = ${postId}
    ${mode === 'read' ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`);
  if (!rows.length || (!allowDeleted && rows[0].estado === 'eliminado'))
    throw new NotFoundException('Post not found');
  if (rows[0].id_grupo !== initial.id_grupo)
    throw new ConflictException(
      'The post changed groups; reload before retrying',
    );
}
