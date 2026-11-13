import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { parsePostId } from '../posts/utils/post-id';
import { ModerationRepository } from './moderation.repository';
import {
  ModerationFilters,
  ReportDto,
  ResolveReportDto,
  ReviewDto,
} from './moderation.dto';
type PostRow = NonNullable<Awaited<ReturnType<ModerationRepository['post']>>>;
@Injectable()
export class ModerationService {
  constructor(private readonly repository: ModerationRepository) {}
  private async authorize(
    repository: ModerationRepository,
    post: PostRow,
    user: AuthenticatedUser,
  ) {
    if (user.role === 'administrador') return;
    const role = post.id_grupo
      ? (await repository.membership(post.id_grupo, user.id))?.rol
      : null;
    if (role !== 'administrador' && role !== 'moderador')
      throw new ForbiddenException();
  }
  private async readable(
    repository: ModerationRepository,
    post: PostRow,
    user: AuthenticatedUser,
  ) {
    if (post.estado !== 'visible') throw new NotFoundException();
    if (
      post.id_grupo &&
      user.role !== 'administrador' &&
      !(await repository.membership(post.id_grupo, user.id))
    )
      throw new ForbiddenException();
  }
  async report(dto: ReportDto, user: AuthenticatedUser) {
    if (Boolean(dto.postId) === Boolean(dto.commentId))
      throw new BadRequestException('Exactly one target is required');
    const commentId = dto.commentId ? parsePostId(dto.commentId) : undefined;
    const initial = commentId ? await this.repository.comment(commentId) : null;
    if (commentId && !initial) throw new NotFoundException();
    const postId = initial?.id_publicacion ?? parsePostId(dto.postId!);
    try {
      return await this.repository.withPost(postId, async (repository) => {
        const post = await repository.post(postId);
        if (!post) throw new NotFoundException();
        await this.readable(repository, post, user);
        if (
          commentId &&
          (await repository.comment(commentId))?.estado !== 'visible'
        )
          throw new NotFoundException();
        return repository.createReport(user.id, dto.reason, postId, commentId);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Already reported');
      throw error;
    }
  }
  async reports(filters: ModerationFilters, user: AuthenticatedUser) {
    const rows = await this.repository.reports(
      user,
      filters.groupId ? parsePostId(filters.groupId) : undefined,
      filters.cursor ? parsePostId(filters.cursor) : undefined,
      filters.status,
      filters.type,
    );
    return {
      items: rows.slice(0, 20).map((row) => this.reportDto(row)),
      nextCursor: rows.length > 20 ? rows[19].id_reporte.toString() : null,
    };
  }
  private reportDto(
    row: NonNullable<Awaited<ReturnType<ModerationRepository['report']>>>,
  ) {
    const post = row.publicacion ?? row.comentario!.publicacion;
    return {
      id: row.id_reporte,
      reason: row.motivo,
      status: (
        {
          pendiente: 'pending',
          desestimado: 'dismissed',
          contenido_retirado: 'content_removed',
          usuario_suspendido: 'user_suspended',
        } as const
      )[row.estado],
      observation: row.observacion,
      createdAt: row.fecha_creacion,
      postId: post.id_publicacion,
      groupId: post.id_grupo,
      title: post.titulo,
      content: row.comentario?.contenido ?? post.contenido,
      type: row.id_comentario ? 'comment' : 'post',
      targetId: row.id_comentario ?? row.id_publicacion,
      contentStatus: (
        {
          visible: 'visible',
          retenido: 'retained',
          eliminado: 'deleted',
        } as const
      )[row.comentario?.estado ?? post.estado],
    };
  }
  async detail(id: bigint, user: AuthenticatedUser) {
    const row = await this.repository.report(id);
    if (!row) throw new NotFoundException();
    const post = row.publicacion ?? row.comentario!.publicacion;
    await this.authorize(this.repository, post, user);
    return this.reportDto(row);
  }
  async resolve(id: bigint, dto: ResolveReportDto, user: AuthenticatedUser) {
    const initial = await this.repository.report(id);
    if (!initial) throw new NotFoundException();
    const postId =
      initial.publicacion?.id_publicacion ?? initial.comentario!.id_publicacion;
    await this.repository.withPost(postId, async (repository) => {
      const row = await repository.report(id);
      if (!row) throw new NotFoundException();
      const post = await repository.post(postId);
      if (!post) throw new NotFoundException();
      await this.authorize(repository, post, user);
      if (row.estado !== 'pendiente')
        throw new ConflictException('Report already resolved');
      const author = row.comentario?.id_autor ?? post.id_autor;
      if (dto.decision === 'usuario_suspendido') {
        if (user.role !== 'administrador') throw new ForbiddenException();
        if (!dto.suspensionDays || author === user.id)
          throw new BadRequestException(
            'Select a suspension duration and another account',
          );
        await repository.suspend(
          author,
          user.id,
          dto.suspensionDays,
          dto.observation,
        );
      }
      if (
        dto.decision !== 'desestimado' &&
        (row.comentario?.estado ?? post.estado) !== 'eliminado'
      ) {
        await repository.decide(
          row.id_comentario ? 'comment' : 'post',
          row.id_comentario ?? postId,
          author,
          user.id,
          'remove',
          dto.observation,
        );
      }
      await repository.resolve(
        id,
        user.id,
        row.id_reportante,
        dto.decision,
        dto.observation,
      );
    });
  }
  async retained(filters: ModerationFilters, user: AuthenticatedUser) {
    const groupId = filters.groupId ? parsePostId(filters.groupId) : undefined,
      cursor = filters.cursor ? parsePostId(filters.cursor) : undefined;
    const type = filters.type ?? 'post';
    if (type === 'comment') {
      const rows = await this.repository.retainedComments(
        user,
        groupId,
        cursor,
      );
      return {
        items: rows.slice(0, 20).map((row) => ({
          id: row.id_comentario,
          type,
          postId: row.id_publicacion,
          title: row.publicacion.titulo,
          content: row.contenido,
          version: null,
        })),
        nextCursor: rows.length > 20 ? rows[19].id_comentario.toString() : null,
      };
    }
    const rows = await this.repository.retainedPosts(user, groupId, cursor);
    return {
      items: rows.slice(0, 20).map((row) => ({
        id: row.id_publicacion,
        type,
        postId: row.id_publicacion,
        title: row.titulo,
        content: row.contenido,
        version: row.version,
      })),
      nextCursor: rows.length > 20 ? rows[19].id_publicacion.toString() : null,
    };
  }
  async review(
    type: string,
    id: bigint,
    dto: ReviewDto,
    user: AuthenticatedUser,
  ) {
    if (type !== 'post' && type !== 'comment') throw new BadRequestException();
    const initial =
      type === 'comment' ? await this.repository.comment(id) : null;
    if (type === 'comment' && !initial) throw new NotFoundException();
    const postId = initial?.id_publicacion ?? id;
    await this.repository.withPost(postId, async (repository) => {
      const post = await repository.post(postId);
      if (!post) throw new NotFoundException();
      await this.authorize(repository, post, user);
      const target = type === 'comment' ? await repository.comment(id) : post;
      if (
        !target ||
        target.estado !== 'retenido' ||
        (type === 'post' && dto.version !== post.version)
      )
        throw new ConflictException('Content changed since review');
      if (dto.decision === 'publish' && type === 'comment') {
        if (post.estado !== 'visible')
          throw new ConflictException('The publication is unavailable');
        const parentId = initial?.id_comentario_padre;
        if (
          parentId &&
          (await repository.comment(parentId))?.estado !== 'visible'
        )
          throw new ConflictException('The parent comment is unavailable');
      }
      await repository.decide(
        type,
        id,
        target.id_autor,
        user.id,
        dto.decision,
        dto.observation,
      );
    });
  }
}
