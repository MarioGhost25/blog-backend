import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const userProfileSelect = {
  id_usuario: true,
  nombre: true,
  apellido: true,
  correo: true,
  rol: true,
  estado: true,
  foto_url: true,
} satisfies Prisma.UsuarioSelect;

type DatabaseUserProfile = Prisma.UsuarioGetPayload<{
  select: typeof userProfileSelect;
}>;

export interface UserProfile {
  id: bigint;
  firstName: string;
  lastName: string;
  email: string;
  role: DatabaseUserProfile['rol'];
  status: DatabaseUserProfile['estado'];
  photoUrl: string | null;
}

export interface CreateUserData {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
}

function toUserProfile(user: DatabaseUserProfile): UserProfile {
  return {
    id: user.id_usuario,
    firstName: user.nombre,
    lastName: user.apellido,
    email: user.correo,
    role: user.rol,
    status: user.estado,
    photoUrl: user.foto_url,
  };
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: bigint): Promise<UserProfile | null> {
    await this.prisma.usuario.updateMany({
      where: {
        id_usuario: id,
        estado: 'suspendido',
        suspendido_hasta: { lte: new Date() },
      },
      data: {
        estado: 'activo',
        suspendido_hasta: null,
        suspendido_por: null,
        motivo_suspension: null,
      },
    });
    const user = await this.prisma.usuario.findUnique({
      where: { id_usuario: id },
      select: userProfileSelect,
    });
    return user ? toUserProfile(user) : null;
  }

  async findByEmail(
    email: string,
  ): Promise<(UserProfile & { passwordHash: string }) | null> {
    await this.prisma.usuario.updateMany({
      where: {
        correo: email,
        estado: 'suspendido',
        suspendido_hasta: { lte: new Date() },
      },
      data: {
        estado: 'activo',
        suspendido_hasta: null,
        suspendido_por: null,
        motivo_suspension: null,
      },
    });
    const user = await this.prisma.usuario.findUnique({
      where: { correo: email },
      select: { ...userProfileSelect, contrasena_hash: true },
    });
    return user
      ? { ...toUserProfile(user), passwordHash: user.contrasena_hash }
      : null;
  }

  async createUser(data: CreateUserData): Promise<UserProfile> {
    const user = await this.prisma.usuario.create({
      data: {
        nombre: data.firstName,
        apellido: data.lastName,
        correo: data.email,
        contrasena_hash: data.passwordHash,
      },
      select: userProfileSelect,
    });
    return toUserProfile(user);
  }

  async createRecoveryToken(
    userId: bigint,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      // Serialize issuance for the same account, including concurrent requests.
      await transaction.$queryRaw`
        SELECT id_usuario FROM usuario WHERE id_usuario = ${userId} FOR UPDATE
      `;
      await transaction.tokenRecuperacion.updateMany({
        where: { id_usuario: userId, fecha_uso: null },
        data: { fecha_uso: new Date() },
      });
      await transaction.tokenRecuperacion.create({
        data: {
          id_usuario: userId,
          token_hash: tokenHash,
          fecha_expiracion: expiresAt,
        },
      });
    });
  }

  async findValidRecoveryToken(
    tokenHash: string,
    now: Date,
  ): Promise<{ id: bigint; userId: bigint } | null> {
    const token = await this.prisma.tokenRecuperacion.findFirst({
      where: {
        token_hash: tokenHash,
        fecha_uso: null,
        fecha_expiracion: { gt: now },
      },
      select: { id_token: true, id_usuario: true },
    });
    return token ? { id: token.id_token, userId: token.id_usuario } : null;
  }

  async invalidateRecoveryToken(tokenHash: string): Promise<void> {
    await this.prisma.tokenRecuperacion.updateMany({
      where: { token_hash: tokenHash, fecha_uso: null },
      data: { fecha_uso: new Date() },
    });
  }

  async consumeRecoveryTokenAndUpdatePassword(
    tokenId: bigint,
    userId: bigint,
    passwordHash: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      // Same lock order as issuance: user first, token second.
      await transaction.$queryRaw`
        SELECT id_usuario FROM usuario WHERE id_usuario = ${userId} FOR UPDATE
      `;
      const now = new Date();
      // Claim the token atomically so concurrent requests cannot reuse it.
      const consumed = await transaction.tokenRecuperacion.updateMany({
        where: {
          id_token: tokenId,
          id_usuario: userId,
          fecha_uso: null,
          fecha_expiracion: { gt: now },
        },
        data: { fecha_uso: now },
      });
      if (consumed.count === 0) return false;

      await transaction.usuario.update({
        where: { id_usuario: userId },
        data: { contrasena_hash: passwordHash },
      });
      return true;
    });
  }
}
