import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { containsProhibitedWords } from '../common/validation/content-text';
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
  private readonly scope = new AsyncLocalStorage<PostsRepository>();
  constructor(private readonly defaultRepository: PostsRepository) {}
  private get repository() {
    return this.scope.getStore() ?? this.defaultRepository;
  }
  withRepository<T>(repository: PostsRepository, work: () => T): T {
    return this.scope.run(repository, work);
  }

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
      if (method === 'POST') {
        const input = dto as CreatePostDto;
        return this.withRepository(repository, () => this.create(user, input));
      }
      await this.withRepository(repository, () =>
        this.requireAuthor(postId!, user),
      );
      if (method === 'PATCH')
        return this.withRepository(repository, () =>
          this.update(postId!, user, dto as UpdatePostDto),
        );
      await this.withRepository(repository, () => this.remove(postId!, user));
      const deleted = await repository.findById(postId!);
      return { id: postId!, version: deleted!.version };
    });
  }

  async create(user: AuthenticatedUser, dto: CreatePostDto) {
    const categoryId = parsePostId(dto.categoryId);
    const groupId = dto.groupId == null ? null : parsePostId(dto.groupId);
    const text = this.cleanText(dto.title, dto.content);
    return this.repository.withGroupLock(groupId, async (repository) => {
      await this.withRepository(repository, () =>
        this.ensureCategory(categoryId),
      );
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

  async findPersonalFeed(user: AuthenticatedUser, query: FilterPostsDto) {
    if (query.q !== undefined)
      throw new BadRequestException('Search uses the public search endpoint');
    const filters = this.filters(query);
    return this.page(
      await this.repository.findPersonalFeedCursor(user.id, filters),
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
        const post = await this.withRepository(repository, () =>
          this.requirePost(postId),
        );
        const role = await this.withRepository(repository, () =>
          this.roleFor(post, user),
        );
        assertCanReadPost(post, user, role);
        return {
          ...post,
          permissions: {
            edit:
              post.authorId === user?.id &&
              (post.groupId === null || role !== null),
            moderate:
              user?.role === 'administrador' ||
              role === 'moderator' ||
              role === 'administrator',
          },
        };
      },
      'read',
    );
  }

  async update(postId: bigint, user: AuthenticatedUser, dto: UpdatePostDto) {
    return this.repository.withPostLock(postId, async (repository) => {
      const post = await this.withRepository(repository, () =>
        this.requireAuthor(postId, user),
      );
      const categoryId =
        dto.categoryId == null ? undefined : parsePostId(dto.categoryId);
      if (categoryId !== undefined)
        await this.withRepository(repository, () =>
          this.ensureCategory(categoryId),
        );
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
      return this.withRepository(repository, () => this.requirePost(postId));
    });
  }

  async remove(postId: bigint, user: AuthenticatedUser, observation?: string) {
    await this.repository.withPostLock(postId, async (repository) => {
      const post = await this.withRepository(repository, () =>
        this.requirePost(postId),
      );
      assertCanDeletePost(
        post,
        user,
        await this.withRepository(repository, () => this.roleFor(post, user)),
      );
      if (post.authorId !== user.id && !observation)
        throw new BadRequestException('An observation is required');
      await repository.changeStatus(postId, 'deleted');
      if (post.authorId !== user.id)
        await repository.recordRemoval(
          postId,
          user.id,
          post.authorId,
          observation!,
        );
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
    const status = containsProhibitedWords(title + ' ' + content)
      ? ('retained' as const)
      : ('visible' as const);
    return { title, content, status };
  }
}
