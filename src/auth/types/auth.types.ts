import type { RolGlobal, EstadoUsuario } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: RolGlobal;
  status: EstadoUsuario;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: bigint;
  role: RolGlobal;
  status: EstadoUsuario;
}
