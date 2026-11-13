import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class MailService {
  constructor(private readonly config: ConfigService) {}

  private createTransport() {
    const host = this.config.get<string>('SMTP_HOST');
    const service = this.config.get<string>('MAILER_SERVICE');
    const from = service
      ? this.config.get<string>('MAILER_EMAIL')
      : this.config.get<string>('SMTP_FROM');
    if ((!service && !host) || !from)
      throw new Error('Recovery mail is not configured');
    const secure = this.config.get<boolean>('SMTP_SECURE', false);
    const user = service
      ? this.config.getOrThrow<string>('MAILER_EMAIL')
      : this.config.get<string>('SMTP_USER');
    const transport = nodemailer.createTransport({
      ...(service
        ? { service }
        : { host, port: this.config.get<number>('SMTP_PORT', 587), secure }),
      requireTLS:
        this.config.get<string>('NODE_ENV') === 'production' &&
        (Boolean(service) || !secure),
      ...(user
        ? {
            auth: {
              user,
              pass: this.config.getOrThrow<string>(
                service ? 'MAILER_SECRET_KEY' : 'SMTP_PASSWORD',
              ),
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
    return { transport, from };
  }

  private recoveryUrl(): URL {
    const base = this.config.get<string>('RECOVERY_URL');
    if (!base) throw new Error('Recovery mail is not configured');
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
    return link;
  }

  async verifyConnection(): Promise<void> {
    this.recoveryUrl();
    const { transport } = this.createTransport();
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }

  async sendRecovery(email: string, token: string): Promise<void> {
    const link = this.recoveryUrl();
    link.pathname = `${link.pathname.replace(/\/$/, '')}/${token}`;
    const { transport, from } = this.createTransport();
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
