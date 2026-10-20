import type { RolGlobal, EstadoUsuario } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  rol: RolGlobal;
  estado: EstadoUsuario;
  iat?: number;
  exp?: number;
}

export interface UsuarioActual {
  id: bigint;
  rol: RolGlobal;
  estado: EstadoUsuario;
}
