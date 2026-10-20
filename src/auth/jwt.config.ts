import type { ConfigService } from '@nestjs/config';

export function obtenerJwtSecret(config: ConfigService): string {
  const secret = config.getOrThrow<string>('JWT_SECRET');
  if (!secret.trim()) throw new Error('JWT_SECRET no puede estar vacío');
  return secret;
}
