import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/usuario-actual.decorator';
import { clearJwtCookie, setJwtCookie } from '../common/security/cookie.helper';
import type { UsuarioActual } from '../common/types/auth.types';
import type { PerfilUsuario } from './auth.repository';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegistroDto } from './dto/registro.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('registro')
  @HttpCode(201)
  registrar(@Body() dto: RegistroDto): Promise<PerfilUsuario> {
    return this.authService.registrar(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async iniciarSesion(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PerfilUsuario> {
    const { token, usuario } = await this.authService.iniciarSesion(dto);
    setJwtCookie(res, token);
    return usuario;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  cerrarSesion(@Res({ passthrough: true }) res: Response): void {
    clearJwtCookie(res);
  }

  @Get('me')
  obtenerPerfilActual(
    @CurrentUser() usuario: UsuarioActual,
  ): Promise<PerfilUsuario> {
    return this.authService.obtenerPerfilActual(usuario.id);
  }
}
