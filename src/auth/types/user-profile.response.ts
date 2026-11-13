import type { UserProfile } from '../auth.repository';
import { InternalServerErrorException } from '@nestjs/common';

export type UserProfileResponse = Omit<
  UserProfile,
  'role' | 'status' | 'id'
> & {
  id: number;
  role: 'user' | 'administrator';
  status: 'active' | 'suspended';
};

export function toUserProfileResponse(user: UserProfile): UserProfileResponse {
  const id = Number(user.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InternalServerErrorException(
      'User identifier exceeds the supported auth contract',
    );
  }
  return {
    ...user,
    id,
    role: user.role === 'administrador' ? 'administrator' : 'user',
    status: user.status === 'activo' ? 'active' : 'suspended',
  };
}
