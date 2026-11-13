import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

describe('mail configuration and connection check', () => {
  const verify = jest.fn();
  const sendMail = jest.fn();
  const close = jest.fn();
  let service: MailService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(nodemailer.createTransport).mockReturnValue({
      verify,
      sendMail,
      close,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    service = new MailService(
      new ConfigService({
        MAILER_SERVICE: 'gmail',
        MAILER_EMAIL: 'sender@example.test',
        MAILER_SECRET_KEY: 'synthetic-secret',
        RECOVERY_URL: 'http://localhost:3000/recuperar',
      }),
    );
  });

  it('checks authentication without sending mail and closes the connection', async () => {
    verify.mockResolvedValue(true);
    await service.verifyConnection();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'gmail',
        auth: { user: 'sender@example.test', pass: 'synthetic-secret' },
      }),
    );
  });

  it('propagates authentication failure and closes the connection', async () => {
    const failure = Object.assign(new Error('authentication failed'), {
      code: 'EAUTH',
    });
    verify.mockRejectedValue(failure);
    await expect(service.verifyConnection()).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses the configured sender and frontend recovery route', async () => {
    sendMail.mockResolvedValue({});
    await service.sendRecovery('recipient@example.test', 'synthetic-token');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'sender@example.test',
        to: 'recipient@example.test',
        text: expect.stringContaining(
          'http://localhost:3000/recuperar/synthetic-token',
        ) as unknown,
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects a recovery URL with query parameters before connecting', async () => {
    service = new MailService(
      new ConfigService({
        RECOVERY_URL: 'https://example.test/reset?next=bad',
      }),
    );
    await expect(service.verifyConnection()).rejects.toThrow(
      'Invalid recovery URL',
    );
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
