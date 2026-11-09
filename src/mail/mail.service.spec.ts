import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

describe('SMTP recovery transport', () => {
  const sendMail = jest.fn<
    Promise<unknown>,
    [{ text: string; messageId: string }]
  >();
  const close = jest.fn();
  let service: MailService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest
      .mocked(nodemailer.createTransport)
      .mockReturnValue({ sendMail, close } as unknown as ReturnType<
        typeof nodemailer.createTransport
      >);
    service = new MailService(
      new ConfigService({
        SMTP_HOST: 'localhost',
        SMTP_FROM: 'test@example.test',
        RECOVERY_URL: 'https://example.test/recuperar',
      }),
    );
  });
  afterEach(() => jest.useRealTimers());

  it('uses the configured URL and closes transport after delivery', async () => {
    sendMail.mockResolvedValueOnce({});
    await service.sendRecovery('recipient@example.test', 'a'.repeat(43));
    expect(sendMail.mock.calls[0][0].text).toContain(
      `https://example.test/recuperar/${'a'.repeat(43)}`,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors with the same message and token', async () => {
    sendMail
      .mockRejectedValueOnce({ responseCode: 450 })
      .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
      .mockResolvedValueOnce({});
    const delivery = service.sendRecovery(
      'recipient@example.test',
      'b'.repeat(43),
    );
    await jest.runAllTimersAsync();
    await delivery;
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(sendMail.mock.calls[0][0]).toEqual(sendMail.mock.calls[2][0]);
  });

  it('does not retry a permanent rejection', async () => {
    sendMail.mockRejectedValueOnce({ responseCode: 550 });
    await expect(
      service.sendRecovery('recipient@example.test', 'c'.repeat(43)),
    ).rejects.toThrow('Recovery delivery failed');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });

  it('stops after three transient failures without exposing provider details', async () => {
    sendMail.mockRejectedValue({
      code: 'EDNS',
      message: 'private provider detail',
    });
    const result = expect(
      service.sendRecovery('recipient@example.test', 'd'.repeat(43)),
    ).rejects.toThrow('Recovery delivery failed');
    await jest.runAllTimersAsync();
    await result;
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalled();
  });
});
