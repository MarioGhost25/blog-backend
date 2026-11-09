import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EstadoUsuario, Prisma } from '@prisma/client';
import { compare, hash } from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import type { JwtPayload } from './types/auth.types';
import { AuthRepository } from './auth.repository';
import type { UserProfile } from './auth.repository';
import { LoginDto, RegisterDto, ResetPasswordDto } from './dto';
import { MailService } from '../mail/mail.service';
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<UserProfile> {
    const email = dto.email.trim().toLowerCase();
    if (await this.repository.findByEmail(email)) {
      throw new ConflictException('Email is already registered');
    }
    // bcrypt limits bytes, not Unicode characters.
    if (Buffer.byteLength(dto.password, 'utf8') > 72) {
      throw new BadRequestException('Password must not exceed 72 bytes');
    }
    const passwordHash = await hash(dto.password, 12);
    try {
      return await this.repository.createUser({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        passwordHash,
      });
    } catch (error: unknown) {
      // The unique constraint also handles concurrent registrations.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<{ token: string; user: UserProfile }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.repository.findByEmail(email);
    if (
      !user ||
      Buffer.byteLength(dto.password, 'utf8') > 72 ||
      !(await compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status === EstadoUsuario.suspendido) {
      throw new ForbiddenException('The account is suspended');
    }
    const payload: JwtPayload = {
      sub: user.id.toString(),
      role: user.role,
      status: user.status,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        status: user.status,
        photoUrl: user.photoUrl,
      },
    };
  }

  async forgotPassword(email: string): Promise<void> {
    const started = performance.now();
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const user = await this.repository.findByEmail(normalizedEmail);
      if (!user) return;

      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await this.repository.createRecoveryToken(user.id, tokenHash, expiresAt);

      try {
        await this.mail.sendRecovery(user.email, rawToken);
      } catch {
        // Never invalidate a newer request's token when this delivery fails.
        await this.repository.invalidateRecoveryToken(tokenHash);
        this.logger.warn('Password recovery delivery failed');
      }
    } catch {
      // Account-specific storage failures must not disclose account existence.
      this.logger.warn('Password recovery processing failed');
    } finally {
      // Same floor for missing accounts and delivery errors; all work is awaited.
      // SMTP timeouts/retries fit this window under normal network failure modes.
      await delay(Math.max(0, 12000 - (performance.now() - started)));
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const token = await this.repository.findValidRecoveryToken(
      tokenHash,
      new Date(),
    );
    if (!token) {
      throw new GoneException('The password reset token is invalid or expired');
    }
    if (Buffer.byteLength(dto.newPassword, 'utf8') > 72) {
      throw new BadRequestException('Password must not exceed 72 bytes');
    }
    const passwordHash = await hash(dto.newPassword, 12);
    const consumed =
      await this.repository.consumeRecoveryTokenAndUpdatePassword(
        token.id,
        token.userId,
        passwordHash,
      );
    if (!consumed) {
      throw new GoneException('The password reset token is invalid or expired');
    }
  }

  async getCurrentProfile(userId: bigint): Promise<UserProfile> {
    const user = await this.repository.findById(userId);
    if (!user)
      throw new UnauthorizedException('The session is no longer valid');
    return user;
  }
}
