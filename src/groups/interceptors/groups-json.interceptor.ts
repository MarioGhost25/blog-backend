import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { apiGroupRole } from '../types/group-role';
import type { RolGrupo } from '@prisma/client';

const responseKeys: Record<string, string> = {
  id_grupo: 'groupId',
  id_categoria: 'categoryId',
  id_creador: 'creatorId',
  id_usuario: 'userId',
  nombre: 'name',
  apellido: 'lastName',
  descripcion: 'description',
  fecha_creacion: 'createdAt',
  fecha_union: 'joinedAt',
  categoria: 'category',
  miembros: 'members',
  miRol: 'myRole',
  administradores: 'administrators',
  rol: 'role',
  usuario: 'user',
  correo: 'email',
  carrera: 'major',
  foto_url: 'photoUrl',
};

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        responseKeys[key] ?? key,
        (key === 'rol' || key === 'miRol') && typeof entry === 'string'
          ? apiGroupRole[entry as RolGrupo]
          : jsonSafe(entry),
      ]),
    );
  return value;
}

@Injectable()
export class GroupsJsonInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map(jsonSafe));
  }
}
