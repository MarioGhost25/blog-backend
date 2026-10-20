import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { EstadoUsuario, RolGlobal } from '@prisma/client';
import { Strategy } from 'passport-jwt';
import { extractJwtFromCookie } from '../../common/security/cookie.helper';
import type { UsuarioActual } from '../../common/types/auth.types';
import { AuthRepository } from '../auth.repository';
import { obtenerJwtSecret } from '../jwt.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly repository: AuthRepository,
  ) {
    super({
      jwtFromRequest: extractJwtFromCookie,
      secretOrKey: obtenerJwtSecret(config),
      algorithms: ['HS256'],
      ignoreExpiration: false,
      jsonWebTokenOptions: { maxAge: '60m' },
    });
  }

  async validate(payload: unknown): Promise<UsuarioActual> {
    if (!payload || typeof payload !== 'object')
      throw new UnauthorizedException();
    const claims = payload as Record<string, unknown>;
    if (
      typeof claims.sub !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(claims.sub) ||
      BigInt(claims.sub) > 9223372036854775807n ||
      (claims.rol !== RolGlobal.usuario &&
        claims.rol !== RolGlobal.administrador) ||
      (claims.estado !== EstadoUsuario.activo &&
        claims.estado !== EstadoUsuario.suspendido) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp)
    )
      throw new UnauthorizedException();
    const usuario = await this.repository.buscarPorId(BigInt(claims.sub));
    if (!usuario) throw new UnauthorizedException('La sesión ya no es válida');
    if (usuario.estado === EstadoUsuario.suspendido) {
      throw new ForbiddenException('La cuenta se encuentra suspendida');
    }
    return { id: usuario.id_usuario, rol: usuario.rol, estado: usuario.estado };
  }
}
