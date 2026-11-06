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

@Injectable()
export class PostsService {
  constructor(private readonly repository: PostsRepository) {}

  async create(user: AuthenticatedUser, dto: CreatePostDto) {
    const categoryId = parsePostId(dto.categoryId);
    await this.ensureCategory(categoryId);
    const groupId = dto.groupId == null ? null : parsePostId(dto.groupId);
    if (
      groupId !== null &&
      !(await this.repository.findGroupMembership(groupId, user.id))
    ) {
      throw new ForbiddenException('Group membership is required');
    }
    const text = this.cleanText(dto.title, dto.content);
    return this.repository.create({
      authorId: user.id,
      categoryId,
      groupId,
      ...text,
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
    if (
      !this.repository.isGlobalAdmin(user) &&
      !(await this.repository.findGroupMembership(groupId, user.id))
    ) {
      throw new ForbiddenException('Group membership is required');
    }
    const { cursor, limit, categoryId } = this.filters(query);
    return this.page(
      await this.repository.findGroupFeedCursor(
        groupId,
        cursor,
        limit,
        categoryId,
      ),
      limit,
    );
  }

  async findOne(postId: bigint, user?: AuthenticatedUser) {
    const post = await this.requirePost(postId);
    const admin = this.repository.isGlobalAdmin(user);
    const membership =
      post.groupId !== null && user
        ? await this.repository.findGroupMembership(post.groupId, user.id)
        : null;
    if (post.groupId !== null && !admin && !membership)
      throw new ForbiddenException('Group membership is required');
    if (
      post.status === 'retained' &&
      post.authorId !== user?.id &&
      !admin &&
      membership?.role !== 'moderator' &&
      membership?.role !== 'administrator'
    ) {
      throw new ForbiddenException('You cannot view this retained post');
    }
    return post;
  }

  async update(postId: bigint, user: AuthenticatedUser, dto: UpdatePostDto) {
    const post = await this.requireAuthor(postId, user);
    const categoryId =
      dto.categoryId == null ? undefined : parsePostId(dto.categoryId);
    if (categoryId !== undefined) await this.ensureCategory(categoryId);
    const text = this.cleanText(
      dto.title ?? post.title,
      dto.content ?? post.content,
    );
    const count = await this.repository.updateWithOptimisticLock(
      postId,
      dto.version,
      { ...text, categoryId },
    );
    if (!count)
      throw new ConflictException(
        'Version conflict: the post was modified by another session',
      );
    return this.requirePost(postId);
  }

  async remove(postId: bigint, user: AuthenticatedUser) {
    const post = await this.requirePost(postId);
    if (post.authorId !== user.id && !this.repository.isGlobalAdmin(user)) {
      const member =
        post.groupId === null
          ? null
          : await this.repository.findGroupMembership(post.groupId, user.id);
      if (member?.role !== 'moderator' && member?.role !== 'administrator')
        throw new ForbiddenException('You cannot delete this post');
    }
    await this.repository.changeStatus(postId, 'deleted');
  }

  async requireAuthor(postId: bigint, user: AuthenticatedUser) {
    const post = await this.requirePost(postId);
    if (post.authorId !== user.id)
      throw new ForbiddenException('Only the author can modify this post');
    return post;
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
