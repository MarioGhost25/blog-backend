import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const perfilSelect = {
  id_usuario: true,
  nombre: true,
  apellido: true,
  correo: true,
  rol: true,
  estado: true,
  foto_url: true,
} satisfies Prisma.UsuarioSelect;

export type PerfilUsuario = Prisma.UsuarioGetPayload<{
  select: typeof perfilSelect;
}>;

export interface CrearUsuarioData {
  nombre: string;
  apellido: string;
  correo: string;
  contrasena_hash: string;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  buscarPorId(id: bigint): Promise<PerfilUsuario | null> {
    return this.prisma.usuario.findUnique({
      where: { id_usuario: id },
      select: perfilSelect,
    });
  }

  buscarPorCorreo(
    correo: string,
  ): Promise<(PerfilUsuario & { contrasena_hash: string }) | null> {
    return this.prisma.usuario.findUnique({
      where: { correo },
      select: { ...perfilSelect, contrasena_hash: true },
    });
  }

  crearUsuario(data: CrearUsuarioData): Promise<PerfilUsuario> {
    return this.prisma.usuario.create({ data, select: perfilSelect });
  }
}
