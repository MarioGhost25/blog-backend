import { ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repository';
import type { AuthenticatedUser } from '../auth/types/auth.types';
describe('Global administrative authorization', () => {
  const summary = jest.fn();
  const users = jest.fn();
  const service = new AdminService({
    summary,
    users,
  } as unknown as AdminRepository);
  const actor = (role: string) => ({ id: 1n, role }) as AuthenticatedUser;
  beforeEach(() => jest.clearAllMocks());
  it('rejects ordinary accounts before querying administrative data', () => {
    expect(() => service.summary(actor('usuario'), 7)).toThrow(
      ForbiddenException,
    );
    expect(() => service.users(actor('usuario'))).toThrow(ForbiddenException);
    expect(summary).not.toHaveBeenCalled();
    expect(users).not.toHaveBeenCalled();
  });
  it('allows the global administrator to query the repository', () => {
    void service.summary(actor('administrador'), 30);
    expect(summary).toHaveBeenCalledWith(30);
    void service.users(actor('administrador'), 'Ana', 5n);
    expect(users).toHaveBeenCalledWith('Ana', 5n, undefined, undefined);
  });
});
