import { Injectable } from '@nestjs/common';
import { EstadoContenido, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const publicProfileSelect = {
  id_usuario: true,
  nombre: true,
  apellido: true,
  carrera: true,
  universidad: true,
  biografia: true,
  foto_url: true,
  rol: true,
  fecha_registro: true,
  _count: {
    select: {
      publicaciones: { where: { estado: EstadoContenido.visible } },
      membresias_grupo: true,
    },
  },
} satisfies Prisma.UsuarioSelect;

const profileSelect = {
  ...publicProfileSelect,
  correo: true,
  foto_public_id: true,
  estado: true,
  suspendido_hasta: true,
  motivo_suspension: true,
  suspendido_por: true,
  _count: { select: { publicaciones: true, membresias_grupo: true } },
} satisfies Prisma.UsuarioSelect;

export interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  major?: string | null;
  university?: string | null;
  bio?: string | null;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findProfileById(id: bigint) {
    return this.prisma.usuario.findUnique({
      where: { id_usuario: id },
      select: profileSelect,
    });
  }

  findPublicProfileById(id: bigint) {
    return this.prisma.usuario.findUnique({
      where: { id_usuario: id },
      select: publicProfileSelect,
    });
  }

  updateProfile(id: bigint, data: UpdateProfileData) {
    return this.prisma.usuario.update({
      where: { id_usuario: id },
      data: {
        nombre: data.firstName,
        apellido: data.lastName,
        carrera: data.major,
        universidad: data.university,
        biografia: data.bio,
      },
      select: profileSelect,
    });
  }

  updatePhoto(id: bigint, photoUrl: string, photoPublicId: string) {
    return this.prisma.usuario.update({
      where: { id_usuario: id },
      data: { foto_url: photoUrl, foto_public_id: photoPublicId },
      select: profileSelect,
    });
  }

  findMyPostsCursor(
    authorId: bigint,
    status?: EstadoContenido,
    cursor?: bigint,
    limit = 20,
  ) {
    return this.prisma.publicacion.findMany({
      where: { id_autor: authorId, ...(status ? { estado: status } : {}) },
      orderBy: [{ fecha_creacion: 'desc' }, { id_publicacion: 'desc' }],
      ...(cursor !== undefined
        ? { cursor: { id_publicacion: cursor }, skip: 1 }
        : {}),
      take: limit + 1,
      include: {
        categoria: true,
        _count: { select: { comentarios: true, adjuntos: true } },
      },
    });
  }
}
