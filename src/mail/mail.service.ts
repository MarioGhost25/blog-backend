import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class MailService {
  constructor(private readonly config: ConfigService) {}

  async sendRecovery(email: string, token: string): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST');
    const from = this.config.get<string>('SMTP_FROM');
    const base = this.config.get<string>('RECOVERY_URL');
    if (!host || !from || !base)
      throw new Error('Recovery mail is not configured');
    // Configuration is trusted, never the incoming Host/Origin headers.
    const link = new URL(base);
    if (
      !['http:', 'https:'].includes(link.protocol) ||
      link.username ||
      link.password ||
      link.search ||
      link.hash
    ) {
      throw new Error('Invalid recovery URL');
    }
    link.pathname = `${link.pathname.replace(/\/$/, '')}/${token}`;
    const secure = this.config.get<boolean>('SMTP_SECURE', false);
    const user = this.config.get<string>('SMTP_USER');
    const transport = nodemailer.createTransport({
      host,
      port: this.config.get<number>('SMTP_PORT', 587),
      secure,
      requireTLS:
        this.config.get<string>('NODE_ENV') === 'production' && !secure,
      ...(user
        ? {
            auth: {
              user,
              pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
            },
          }
        : {}),
      connectionTimeout: 1000,
      greetingTimeout: 1000,
      socketTimeout: 1000,
      dnsTimeout: 1000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const message = {
      from,
      to: email,
      messageId: `<${randomUUID()}@recovery.local>`,
      subject: 'Restablece tu contraseña',
      text: `Solicitaste restablecer tu contraseña. El enlace vence en 30 minutos y solo puede utilizarse una vez.\n\n${link.href}\n\nSi no lo solicitaste, ignora este mensaje.`,
    };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await transport.sendMail(message);
          return;
        } catch (error: unknown) {
          const failure = error as { responseCode?: number; code?: string };
          const transient =
            (failure.responseCode !== undefined &&
              failure.responseCode >= 400 &&
              failure.responseCode < 500) ||
            ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS'].includes(
              failure.code ?? '',
            );
          if (!transient || attempt === 2)
            throw new Error('Recovery delivery failed');
          await delay(250 * 2 ** attempt);
        }
      }
    } finally {
      transport.close();
    }
  }
}
