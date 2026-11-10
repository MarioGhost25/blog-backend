import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import {
  assertCanReadPost,
  assertPostAuthor,
  assertCanDeletePost,
  type LocalPostRole,
} from './post-access';

const author: AuthenticatedUser = { id: 2n, role: 'usuario', status: 'activo' };
const other: AuthenticatedUser = { ...author, id: 3n };
const global: AuthenticatedUser = { ...other, role: 'administrador' };
const groupPost = { authorId: 2n, groupId: 1n, status: 'visible' };

describe('group post policy', () => {
  it('revoked authors lose read, write and deletion; membership restores their author rights', () => {
    for (const operation of [
      assertCanReadPost,
      assertPostAuthor,
      assertCanDeletePost,
    ]) {
      expect(() => operation(groupPost, author, null)).toThrow(
        ForbiddenException,
      );
      expect(() => operation(groupPost, author, 'member')).not.toThrow();
    }
  });
  it.each(['member', 'moderator', 'administrator'] as LocalPostRole[])(
    'a %s never acquires another author’s editing rights',
    (role) => {
      expect(() => assertPostAuthor(groupPost, other, role)).toThrow(
        ForbiddenException,
      );
      expect(() => assertCanReadPost(groupPost, other, role)).not.toThrow();
    },
  );
  it('global moderation grants read/removal, never editing or authorship after leaving', () => {
    expect(() => assertCanReadPost(groupPost, global, null)).not.toThrow();
    expect(() => assertCanDeletePost(groupPost, global, null)).not.toThrow();
    expect(() => assertPostAuthor(groupPost, global, 'administrator')).toThrow(
      ForbiddenException,
    );
    expect(() =>
      assertPostAuthor(groupPost, { ...global, id: author.id }, null),
    ).toThrow(ForbiddenException);
  });
  it('retained group content is limited to its current author and moderators', () => {
    const post = { ...groupPost, status: 'retained' };
    expect(() => assertCanReadPost(post, other, 'member')).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanReadPost(post, author, null)).toThrow(
      ForbiddenException,
    );
    for (const role of ['moderator', 'administrator'] as const)
      expect(() => assertCanReadPost(post, other, role)).not.toThrow();
    expect(() => assertCanReadPost(post, author, 'member')).not.toThrow();
    expect(() => assertCanReadPost(post, global, null)).not.toThrow();
  });
  it('public content retains visitor reading and author editing without group membership', () => {
    const post = { ...groupPost, groupId: null };
    expect(() => assertCanReadPost(post, undefined, null)).not.toThrow();
    expect(() => assertPostAuthor(post, author, null)).not.toThrow();
    expect(() => assertCanDeletePost(post, other, null)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      assertCanReadPost({ ...post, status: 'retained' }, undefined, null),
    ).toThrow(ForbiddenException);
  });
});
