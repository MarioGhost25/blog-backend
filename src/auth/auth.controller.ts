import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { clearJwtCookie, setJwtCookie } from './security/cookie.helper';
import type { AuthenticatedUser } from './types/auth.types';
import { toUserProfileResponse } from './types/user-profile.response';
import type { UserProfileResponse } from './types/user-profile.response';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto): Promise<UserProfileResponse> {
    return toUserProfileResponse(await this.authService.register(dto));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserProfileResponse> {
    const { token, user } = await this.authService.login(dto);
    setJwtCookie(res, token);
    return toUserProfileResponse(user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    clearJwtCookie(res);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'If the account exists, password reset instructions will be provided.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  async getCurrentProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserProfileResponse> {
    return toUserProfileResponse(
      await this.authService.getCurrentProfile(user.id),
    );
  }
}
