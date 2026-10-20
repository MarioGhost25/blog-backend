import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EstadoUsuario, Prisma } from '@prisma/client';
import { compare, hash } from 'bcrypt';
import type { JwtPayload } from '../common/types/auth.types';
import { AuthRepository } from './auth.repository';
import type { PerfilUsuario } from './auth.repository';
import { LoginDto } from './dto/login.dto';
import { RegistroDto } from './dto/registro.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwt: JwtService,
  ) {}

  async registrar(dto: RegistroDto): Promise<PerfilUsuario> {
    const correo = dto.correo.trim().toLowerCase();
    if (await this.repository.buscarPorCorreo(correo)) {
      throw new ConflictException('El correo ya está registrado');
    }
    // bcrypt limita por bytes, no por caracteres Unicode.
    if (Buffer.byteLength(dto.contrasena, 'utf8') > 72) {
      throw new BadRequestException('La contraseña no puede superar 72 bytes');
    }
    const contrasena_hash = await hash(dto.contrasena, 12);
    try {
      return await this.repository.crearUsuario({
        nombre: dto.nombre,
        apellido: dto.apellido,
        correo,
        contrasena_hash,
      });
    } catch (error: unknown) {
      // La restricción única también cubre registros simultáneos.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('El correo ya está registrado');
      }
      throw error;
    }
  }

  async iniciarSesion(
    dto: LoginDto,
  ): Promise<{ token: string; usuario: PerfilUsuario }> {
    const correo = dto.correo.trim().toLowerCase();
    const usuario = await this.repository.buscarPorCorreo(correo);
    if (
      !usuario ||
      Buffer.byteLength(dto.contrasena, 'utf8') > 72 ||
      !(await compare(dto.contrasena, usuario.contrasena_hash))
    ) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (usuario.estado === EstadoUsuario.suspendido) {
      throw new ForbiddenException('La cuenta se encuentra suspendida');
    }
    const payload: JwtPayload = {
      sub: usuario.id_usuario.toString(),
      rol: usuario.rol,
      estado: usuario.estado,
    };
    return {
      token: await this.jwt.signAsync(payload),
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        correo: usuario.correo,
        rol: usuario.rol,
        estado: usuario.estado,
        foto_url: usuario.foto_url,
      },
    };
  }

  async obtenerPerfilActual(idUsuario: bigint): Promise<PerfilUsuario> {
    const usuario = await this.repository.buscarPorId(idUsuario);
    if (!usuario) throw new UnauthorizedException('La sesión ya no es válida');
    return usuario;
  }
}
