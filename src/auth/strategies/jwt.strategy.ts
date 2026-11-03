import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { EstadoUsuario, RolGlobal } from '@prisma/client';
import { Strategy } from 'passport-jwt';
import { extractJwtFromCookie } from '../security/cookie.helper';
import type { AuthenticatedUser } from '../types/auth.types';
import { AuthRepository } from '../auth.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly repository: AuthRepository,
  ) {
    super({
      jwtFromRequest: extractJwtFromCookie,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      ignoreExpiration: false,
      jsonWebTokenOptions: { maxAge: '60m' },
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    if (!payload || typeof payload !== 'object')
      throw new UnauthorizedException();
    const claims = payload as Record<string, unknown>;
    if (
      typeof claims.sub !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(claims.sub) ||
      BigInt(claims.sub) > 9223372036854775807n ||
      (claims.role !== RolGlobal.usuario &&
        claims.role !== RolGlobal.administrador) ||
      (claims.status !== EstadoUsuario.activo &&
        claims.status !== EstadoUsuario.suspendido) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp)
    )
      throw new UnauthorizedException();
    const user = await this.repository.findById(BigInt(claims.sub));
    if (!user)
      throw new UnauthorizedException('The session is no longer valid');
    if (user.status === EstadoUsuario.suspendido) {
      throw new ForbiddenException('The account is suspended');
    }
    return { id: user.id, role: user.role, status: user.status };
  }
}
