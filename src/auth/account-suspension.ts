import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export function reactivateExpiredAccounts(
  db: Pick<Prisma.TransactionClient, 'usuario'>,
  target: Prisma.UsuarioWhereInput = {},
) {
  return db.usuario.updateMany({
    where: {
      AND: [
        target,
        { estado: 'suspendido', suspendido_hasta: { lte: new Date() } },
      ],
    },
    data: {
      estado: 'activo',
      suspendido_hasta: null,
      suspendido_por: null,
      motivo_suspension: null,
    },
  });
}

/** Caller owns the transaction; report resolution and future administration share this policy. */
export async function suspendAccount(
  tx: Prisma.TransactionClient,
  id: bigint,
  actor: bigint,
  days: number,
  reason: string,
) {
  if (
    id === actor ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 90 ||
    reason.trim().length < 5 ||
    reason.length > 500
  )
    throw new BadRequestException(
      'Suspension requires another account, 1–90 days and a reason of 5–500 characters',
    );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(61110001)::text`;
  const current = await tx.usuario.findUnique({
    where: { id_usuario: actor },
    select: { estado: true, rol: true },
  });
  if (current?.estado !== 'activo' || current.rol !== 'administrador')
    throw new ForbiddenException();
  await tx.usuario.update({
    where: { id_usuario: id },
    data: {
      estado: 'suspendido',
      suspendido_hasta: new Date(Date.now() + days * 86400000),
      suspendido_por: actor,
      motivo_suspension: reason,
    },
  });
}
