import { compare } from 'bcrypt';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { AuthRepository } from './auth.repository';
import type { MailService } from '../mail/mail.service';

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
describe('login for missing accounts', () => {
  it('performs bcrypt comparison with a cost-12 dummy hash before returning the same rejection', async () => {
    (
      compare as jest.MockedFunction<
        (password: string, hash: string) => Promise<boolean>
      >
    ).mockResolvedValue(false);
    const service = new AuthService(
      {
        findByEmail: jest.fn().mockResolvedValue(null),
      } as unknown as AuthRepository,
      {} as JwtService,
      {} as MailService,
    );
    await expect(
      service.login({
        email: 'missing@example.test',
        password: 'Wrong-test-42!',
      }),
    ).rejects.toThrow('Invalid credentials');
    expect(compare).toHaveBeenCalledWith(
      'Wrong-test-42!',
      expect.stringMatching(/^\$2[ab]\$12\$/),
    );
  });
});
