import type { UserProfile } from '../auth.repository';

export type UserProfileResponse = Omit<UserProfile, 'role' | 'status'> & {
  role: 'user' | 'administrator';
  status: 'active' | 'suspended';
};

export function toUserProfileResponse(user: UserProfile): UserProfileResponse {
  return {
    ...user,
    role: user.role === 'administrador' ? 'administrator' : 'user',
    status: user.status === 'activo' ? 'active' : 'suspended',
  };
}
