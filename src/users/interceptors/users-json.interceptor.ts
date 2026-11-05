import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

const responseKeys: Record<string, string> = {
  id_usuario: 'id',
  nombre: 'name',
  apellido: 'lastName',
  correo: 'email',
  carrera: 'major',
  universidad: 'university',
  biografia: 'bio',
  foto_url: 'photoUrl',
  foto_public_id: 'photoPublicId',
  rol: 'role',
  estado: 'status',
  suspendido_hasta: 'suspendedUntil',
  motivo_suspension: 'suspensionReason',
  suspendido_por: 'suspendedBy',
  fecha_registro: 'registeredAt',
  publicaciones: 'posts',
  membresias_grupo: 'groups',
  id_publicacion: 'postId',
  id_autor: 'authorId',
  id_categoria: 'categoryId',
  id_grupo: 'groupId',
  titulo: 'title',
  contenido: 'content',
  fecha_creacion: 'createdAt',
  fecha_edicion: 'updatedAt',
  categoria: 'category',
  descripcion: 'description',
  comentarios: 'comments',
  adjuntos: 'attachments',
};

const responseValues: Record<string, string> = {
  usuario: 'user',
  administrador: 'administrator',
  activo: 'active',
  suspendido: 'suspended',
  visible: 'visible',
  retenido: 'held',
  eliminado: 'deleted',
};

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key === 'nombre' && 'id_usuario' in value
          ? 'firstName'
          : (responseKeys[key] ?? key),
        (key === 'rol' || key === 'estado') && typeof entry === 'string'
          ? (responseValues[entry] ?? entry)
          : jsonSafe(entry),
      ]),
    );
  }
  return value;
}

@Injectable()
export class UsersJsonInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map(jsonSafe));
  }
}
