import { Logger } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { AuthRepository } from './auth.repository';
import type { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';

describe('recovery failure and privacy', () => {
  let warning: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('invalidates only its own token on delivery failure, waits and logs no token', async () => {
    const repository = {
      findByEmail: jest
        .fn()
        .mockResolvedValue({ id: 1n, email: 'synthetic@example.test' }),
      createRecoveryToken: jest
        .fn<Promise<void>, [bigint, string, Date]>()
        .mockResolvedValue(undefined),
      invalidateRecoveryToken: jest.fn().mockResolvedValue(undefined),
    };
    const mail = {
      sendRecovery: jest
        .fn<Promise<void>, [string, string]>()
        .mockRejectedValue(new Error('provider secret')),
    };
    const service = new AuthService(
      repository as unknown as AuthRepository,
      {} as JwtService,
      mail as unknown as MailService,
    );
    const pending = service.forgotPassword('synthetic@example.test');
    await jest.runAllTimersAsync();
    await pending;
    const hash = repository.createRecoveryToken.mock.calls[0][1];
    expect(hash).toHaveLength(64);
    expect(repository.invalidateRecoveryToken).toHaveBeenCalledWith(hash);
    const token = mail.sendRecovery.mock.calls[0][1];
    expect(token).toHaveLength(43);
    expect(warning).toHaveBeenCalledWith('Password recovery delivery failed');
    expect(JSON.stringify(warning.mock.calls)).not.toContain(token);
    expect(performance.now()).toBeGreaterThanOrEqual(12000);
  });

  it('waits the same floor for a missing account and never sends mail', async () => {
    const repository = { findByEmail: jest.fn().mockResolvedValue(null) };
    const mail = { sendRecovery: jest.fn() };
    const service = new AuthService(
      repository as unknown as AuthRepository,
      {} as JwtService,
      mail as unknown as MailService,
    );
    const pending = service.forgotPassword('absent@example.test');
    await jest.runAllTimersAsync();
    await pending;
    expect(mail.sendRecovery).not.toHaveBeenCalled();
    expect(performance.now()).toBeGreaterThanOrEqual(12000);
  });
});
