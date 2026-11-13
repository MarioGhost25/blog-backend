import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/types/auth.types';

export type LocalPostRole = 'member' | 'moderator' | 'administrator' | null;
type PostAccessTarget = {
  authorId: bigint;
  groupId: bigint | null;
  status: string;
};
export const isGlobalModerator = (user?: AuthenticatedUser) =>
  user?.role === 'administrador';

export function assertCanReadGroup(
  user: AuthenticatedUser | undefined,
  role: LocalPostRole,
) {
  if (!isGlobalModerator(user) && !role)
    throw new ForbiddenException('Group membership is required');
}

export function assertCanReadPost(
  post: PostAccessTarget,
  user: AuthenticatedUser | undefined,
  role: LocalPostRole,
) {
  if (post.groupId !== null) assertCanReadGroup(user, role);
  if (
    post.status === 'retained' &&
    post.authorId !== user?.id &&
    !isGlobalModerator(user) &&
    role !== 'moderator' &&
    role !== 'administrator'
  ) {
    throw new ForbiddenException('You cannot view this retained post');
  }
}

export function assertPostAuthor(
  post: PostAccessTarget,
  user: AuthenticatedUser,
  role: LocalPostRole,
) {
  if (post.authorId !== user.id)
    throw new ForbiddenException('Only the author can modify this post');
  // Global moderation does not confer authorship or restore a former member's
  // right to publish/edit/upload. D02 applies to every author.
  if (post.groupId !== null && !role)
    throw new ForbiddenException('Group membership is required');
}

export function assertCanDeletePost(
  post: PostAccessTarget,
  user: AuthenticatedUser,
  role: LocalPostRole,
) {
  if (isGlobalModerator(user)) return;
  if (post.groupId !== null && !role)
    throw new ForbiddenException('Group membership is required');
  if (
    post.authorId !== user.id &&
    role !== 'moderator' &&
    role !== 'administrator'
  ) {
    throw new ForbiddenException('You cannot delete this post');
  }
}
