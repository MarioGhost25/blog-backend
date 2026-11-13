import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsService } from '../posts/posts.service';
import { assertCanDeletePost } from '../posts/policies/post-access';
import { parsePostId } from '../posts/utils/post-id';
import { containsProhibitedWords } from '../common/validation/content-text';
import { CommentsRepository } from './comments.repository';
import {
  CommentPageDto,
  CreateCommentDto,
  RemoveContentDto,
} from './comments.dto';
@Injectable()
export class CommentsService {
  constructor(
    private readonly repository: CommentsRepository,
    private readonly posts: PostsService,
  ) {}
  list(postId: bigint, query: CommentPageDto, user?: AuthenticatedUser) {
    const cursor = query.cursor ? parsePostId(query.cursor) : undefined;
    return this.repository.withPost(
      postId,
      async (repository, posts) => {
        const post = await this.posts.withRepository(posts, () =>
          this.posts.findOne(postId, user),
        );
        if (post.status !== 'visible')
          throw new ForbiddenException(
            'Conversation is unavailable until publication approval',
          );
        return repository.page(postId, user?.id, cursor, query.limit);
      },
      'read',
    );
  }
  create(postId: bigint, dto: CreateCommentDto, user: AuthenticatedUser) {
    const parentId = dto.parentCommentId
      ? parsePostId(dto.parentCommentId)
      : undefined;
    return this.repository.withPost(postId, async (repository, posts) => {
      const post = await this.posts.withRepository(posts, () =>
        this.posts.findOne(postId, user),
      );
      if (
        post.status !== 'visible' ||
        (post.groupId &&
          !(await posts.findGroupMembership(post.groupId, user.id)))
      )
        throw new ForbiddenException();
      const parent = parentId ? await repository.find(parentId) : null;
      if (
        parentId &&
        (!parent ||
          parent.id_publicacion !== postId ||
          parent.estado !== 'visible')
      )
        throw new BadRequestException(
          'The parent must be a visible comment in the same publication',
        );
      return repository.create(
        postId,
        user.id,
        dto.content,
        containsProhibitedWords(dto.content),
        parentId,
        post.authorId,
        parent?.id_autor,
      );
    });
  }
  async remove(id: bigint, dto: RemoveContentDto, user: AuthenticatedUser) {
    const initial = await this.repository.find(id);
    if (!initial) throw new NotFoundException();
    await this.repository.withPost(
      initial.id_publicacion,
      async (repository, posts) => {
        const row = await repository.find(id);
        if (!row || row.estado === 'eliminado') throw new NotFoundException();
        const post = await this.posts.withRepository(posts, () =>
          this.posts.findOne(row.id_publicacion, user),
        );
        const role = post.groupId
          ? ((await posts.findGroupMembership(post.groupId, user.id))?.role ??
            null)
          : null;
        assertCanDeletePost({ ...post, authorId: row.id_autor }, user, role);
        if (row.id_autor !== user.id && !dto?.observation)
          throw new BadRequestException(
            'An observation is required to remove another author content',
          );
        await repository.remove(id, user.id, row.id_autor, dto?.observation);
      },
    );
  }
}
