import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsRepository, type PostDetail } from './posts.repository';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { FilterPostsDto, SearchPostsDto } from './dto/filter-posts.dto';
import { parsePostId } from './utils/post-id';
import { identifyOperation, type PostMethod } from './types/post-operation';
import {
  assertCanReadGroup,
  assertCanReadPost,
  assertPostAuthor,
  assertCanDeletePost,
} from './policies/post-access';

@Injectable()
export class PostsService {
  constructor(private readonly repository: PostsRepository) {}

  getOperation(user: AuthenticatedUser, key: string, owner?: string) {
    const operation = identifyOperation(
      user.id,
      key,
      owner,
      'POST',
      undefined,
      {},
    );
    return this.repository.findOperation(user.id, operation.key);
  }

  writeOperation(
    user: AuthenticatedUser,
    key: string,
    owner: string | undefined,
    method: PostMethod,
    postId?: bigint,
    dto?: CreatePostDto | UpdatePostDto,
  ) {
    const operation = identifyOperation(
      user.id,
      key,
      owner,
      method,
      postId,
      dto ?? {},
    );
    return this.repository.executeOperation(operation, async (repository) => {
      const service = new PostsService(repository);
      if (method === 'POST') {
        const input = dto as CreatePostDto;
        if (input.groupId != null)
          throw new ForbiddenException(
            'Operation receipts currently support public posts only',
          );
        return service.create(user, input);
      }
      const post = await service.requireAuthor(postId!, user);
      if (post.groupId !== null)
        throw new ForbiddenException(
          'Operation receipts currently support public posts only',
        );
      if (method === 'PATCH')
        return service.update(postId!, user, dto as UpdatePostDto);
      await service.remove(postId!, user);
      const deleted = await repository.findById(postId!);
      return { id: postId!, version: deleted!.version };
    });
  }

  async create(user: AuthenticatedUser, dto: CreatePostDto) {
    const categoryId = parsePostId(dto.categoryId);
    const groupId = dto.groupId == null ? null : parsePostId(dto.groupId);
    const text = this.cleanText(dto.title, dto.content);
    return this.repository.withGroupLock(groupId, async (repository) => {
      await new PostsService(repository).ensureCategory(categoryId);
      if (
        groupId !== null &&
        !(await repository.findGroupMembership(groupId, user.id))
      ) {
        throw new ForbiddenException('Group membership is required');
      }
      return repository.create({
        authorId: user.id,
        categoryId,
        groupId,
        ...text,
      });
    });
  }

  async findPublicFeed(query: FilterPostsDto) {
    if (query.q != null) return this.search(query);
    const filters = this.filters(query);
    return this.page(
      await this.repository.findPublicFeedCursor(filters),
      filters.limit,
    );
  }

  async search(query: SearchPostsDto) {
    if (!query.q || query.q.trim().length < 2)
      throw new BadRequestException(
        'A search query of at least two characters is required',
      );
    const { categoryId, cursor, limit } = this.filters(query);
    return this.page(
      await this.repository.searchFullText(
        query.q.trim(),
        categoryId,
        cursor,
        limit,
      ),
      limit,
    );
  }

  async findGroupFeed(
    groupId: bigint,
    user: AuthenticatedUser,
    query: FilterPostsDto,
  ) {
    const { cursor, limit, categoryId } = this.filters(query);
    return this.repository.withGroupLock(
      groupId,
      async (repository) => {
        const member = await repository.findGroupMembership(groupId, user.id);
        assertCanReadGroup(user, member?.role ?? null);
        return this.page(
          await repository.findGroupFeedCursor(
            groupId,
            cursor,
            limit,
            categoryId,
          ),
          limit,
        );
      },
      'read',
    );
  }

  async findOne(postId: bigint, user?: AuthenticatedUser) {
    return this.repository.withPostLock(
      postId,
      async (repository) => {
        const service = new PostsService(repository);
        const post = await service.requirePost(postId);
        assertCanReadPost(post, user, await service.roleFor(post, user));
        return post;
      },
      'read',
    );
  }

  async update(postId: bigint, user: AuthenticatedUser, dto: UpdatePostDto) {
    return this.repository.withPostLock(postId, async (repository) => {
      const service = new PostsService(repository);
      const post = await service.requireAuthor(postId, user);
      const categoryId =
        dto.categoryId == null ? undefined : parsePostId(dto.categoryId);
      if (categoryId !== undefined) await service.ensureCategory(categoryId);
      const text = this.cleanText(
        dto.title ?? post.title,
        dto.content ?? post.content,
      );
      const count = await repository.updateWithOptimisticLock(
        postId,
        dto.version,
        { ...text, categoryId },
      );
      if (!count)
        throw new ConflictException(
          'Version conflict: the post was modified by another session',
        );
      return service.requirePost(postId);
    });
  }

  async remove(postId: bigint, user: AuthenticatedUser) {
    await this.repository.withPostLock(postId, async (repository) => {
      const service = new PostsService(repository);
      const post = await service.requirePost(postId);
      assertCanDeletePost(post, user, await service.roleFor(post, user));
      await repository.changeStatus(postId, 'deleted');
    });
  }

  async requireAuthor(postId: bigint, user: AuthenticatedUser) {
    const post = await this.requirePost(postId);
    assertPostAuthor(post, user, await this.roleFor(post, user));
    return post;
  }

  private async roleFor(post: PostDetail, user?: AuthenticatedUser) {
    if (post.groupId === null || !user) return null;
    return (
      (await this.repository.findGroupMembership(post.groupId, user.id))
        ?.role ?? null
    );
  }

  private async requirePost(postId: bigint) {
    const post = await this.repository.findById(postId);
    if (!post || post.status === 'deleted')
      throw new NotFoundException('Post not found');
    return post;
  }

  private async ensureCategory(id: bigint) {
    if (!(await this.repository.categoryExists(id)))
      throw new NotFoundException('Category not found');
  }

  private filters(query: FilterPostsDto) {
    return {
      categoryId:
        query.categoryId == null ? undefined : parsePostId(query.categoryId),
      cursor: query.cursor == null ? undefined : parsePostId(query.cursor),
      limit: query.limit ?? 20,
    };
  }

  private page(items: PostDetail[], limit: number) {
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
    };
  }

  private cleanText(rawTitle: string, rawContent: string) {
    const title = sanitizeHtml(rawTitle, {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();
    const content = sanitizeHtml(rawContent, {
      allowedTags: [
        'p',
        'br',
        'strong',
        'em',
        'b',
        'i',
        'ul',
        'ol',
        'li',
        'blockquote',
        'code',
        'pre',
        'a',
      ],
      allowedAttributes: { a: ['href', 'title'] },
      allowedSchemes: ['http', 'https'],
      allowProtocolRelative: false,
    }).trim();
    if (
      title.length < 3 ||
      title.length > 150 ||
      !sanitizeHtml(content, {
        allowedTags: [],
        allowedAttributes: {},
      }).trim() ||
      content.length > 20000
    ) {
      throw new BadRequestException(
        'Title and content must remain valid after sanitization',
      );
    }
    const plainText = sanitizeHtml(title + ' ' + content, {
      allowedTags: [],
      allowedAttributes: {},
    })
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const prohibitedWords = ['idiota', 'imbecil', 'mierda', 'fuck', 'shit'];
    const words = plainText.match(/[\p{L}\p{N}]+/gu) ?? [];
    const status = words.some((word) => prohibitedWords.includes(word))
      ? ('retained' as const)
      : ('visible' as const);
    return { title, content, status };
  }
}
