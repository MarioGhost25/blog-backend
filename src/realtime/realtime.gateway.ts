import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { Client } from 'pg';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { PostsService } from '../posts/posts.service';
import { PostsRepository } from '../posts/posts.repository';
import { parsePostId } from '../posts/utils/post-id';
interface Connection {
  id: string;
  socket: WebSocket;
  user: AuthenticatedUser;
  claims: unknown;
  expires: number;
  rooms: Set<string>;
  alive: boolean;
  messages: number;
  since: number;
  queue: Promise<void>;
}
interface Change {
  event: string;
  postId?: string;
  groupId?: string;
  userId?: string;
  room?: string;
}
@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly upgrades = new Map<
    string,
    { count: number; until: number }
  >();
  private listener?: Client;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private readonly changes = new Map<string, Change>();
  private stopped = false;
  private ticking = false;
  private http?: Server;
  private readonly upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    void this.accept(request, socket, head);
  };
  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly config: ConfigService,
    private readonly strategy: JwtStrategy,
    private readonly prisma: PrismaService,
    private readonly posts: PostsService,
    private readonly repository: PostsRepository,
  ) {}
  async onModuleInit() {
    this.http = this.adapter.httpAdapter.getHttpServer() as Server;
    this.http.on('upgrade', this.upgrade);
    await this.listen();
    this.heartbeat = setInterval(() => {
      void this.tick();
    }, 10000);
    this.heartbeat.unref();
  }
  private async listen() {
    if (this.stopped) return;
    const client = new Client({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      ...(this.config.get<string>('DYNO')
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
    });
    this.listener = client;
    client.on('error', () => {
      this.logger.warn('Realtime database listener disconnected');
      for (const connection of this.connections.values())
        connection.socket.close(1012, 'Reconnecting');
      void client.end().catch(() => undefined);
      if (!this.stopped && !this.reconnect)
        this.reconnect = setTimeout(() => {
          this.reconnect = undefined;
          void this.listen();
        }, 3000);
    });
    client.on('notification', (message) => {
      try {
        const change = JSON.parse(message.payload ?? '') as Change;
        if (typeof change.event !== 'string') return;
        this.changes.set(
          `${change.event}:${change.postId ?? change.groupId ?? change.userId ?? change.room ?? ''}`,
          change,
        );
        if (!this.flushTimer)
          this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.flush();
          }, 50);
      } catch {
        /* No untrusted payload is forwarded. */
      }
    });
    try {
      await client.connect();
      await client.query('LISTEN blog_events');
    } catch {
      await client.end().catch(() => undefined);
      if (!this.stopped && !this.reconnect)
        this.reconnect = setTimeout(() => {
          this.reconnect = undefined;
          void this.listen();
        }, 3000);
    }
  }
  private async accept(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const reject = () => {
      if (!socket.destroyed)
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    };
    if (request.url !== '/tiempo-real') {
      socket.destroy();
      return;
    }
    try {
      const origin =
        this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      if (
        request.headers.origin !== new URL(origin).origin ||
        this.connections.size >= 1000
      ) {
        reject();
        return;
      }
      const now = Date.now(),
        ip = request.socket.remoteAddress ?? 'unknown';
      for (const [key, bucket] of this.upgrades)
        if (bucket.until < now) this.upgrades.delete(key);
      const bucket = this.upgrades.get(ip) ?? { count: 0, until: now + 60000 };
      if (++bucket.count > 120 || this.upgrades.size > 10000) {
        reject();
        return;
      }
      this.upgrades.set(ip, bucket);
      const token = request.headers.cookie?.match(
        /(?:^|;\s*)jwt=([A-Za-z0-9._-]+)(?:;|$)/,
      )?.[1];
      if (!token) {
        reject();
        return;
      }
      const jwt = new JwtService({
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      const claims: unknown = await jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        maxAge: '60m',
      });
      const user = await this.strategy.validate(claims);
      const expires = (claims as { exp: number }).exp * 1000;
      if (
        socket.destroyed ||
        [...this.connections.values()].filter((c) => c.user.id === user.id)
          .length >= 12
      ) {
        reject();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (ws) => {
        const connection: Connection = {
          id: randomUUID(),
          socket: ws,
          user,
          claims,
          expires,
          rooms: new Set(),
          alive: true,
          messages: 0,
          since: now,
          queue: Promise.resolve(),
        };
        this.connections.set(ws, connection);
        ws.on('pong', () => {
          connection.alive = true;
        });
        ws.on('message', (data) => {
          const now = Date.now();
          if (now - connection.since > 60000) {
            connection.since = now;
            connection.messages = 0;
          }
          if (++connection.messages > 30) {
            ws.close(4008, 'Rate limited');
            return;
          }
          connection.queue = connection.queue
            .then(() => this.message(connection, data))
            .catch(() => {
              this.send(connection, 'error', { message: 'Solicitud inválida' });
            });
        });
        ws.on('error', () => ws.terminate());
        ws.on('close', () => {
          this.connections.delete(ws);
          void this.prisma.presenciaSala
            .deleteMany({ where: { conexion: connection.id } })
            .catch(() => undefined);
        });
        this.send(connection, 'conexion:lista', {});
      });
    } catch {
      reject();
    }
  }
  private async authenticate(connection: Connection) {
    if (connection.expires <= Date.now()) {
      connection.socket.close(4001, 'Session expired');
      return false;
    }
    try {
      connection.user = await this.strategy.validate(connection.claims);
      return true;
    } catch {
      this.send(connection, 'cuenta:suspendida', {});
      connection.socket.close(4003, 'Access revoked');
      return false;
    }
  }
  private async roomAllowed(connection: Connection, room: string) {
    const [type, id] = room.split(':');
    try {
      const value = parsePostId(id);
      if (type === 'publicacion') {
        await this.posts.findOne(value, connection.user);
        return true;
      }
      if (type === 'grupo')
        return (
          Boolean(
            await this.prisma.grupoEstudio.count({
              where: { id_grupo: value },
            }),
          ) &&
          (connection.user.role === 'administrador' ||
            Boolean(
              await this.repository.findGroupMembership(
                value,
                connection.user.id,
              ),
            ))
        );
      return false;
    } catch {
      return false;
    }
  }
  private async revalidate(connection: Connection) {
    if (!(await this.authenticate(connection))) return false;
    for (const room of connection.rooms)
      if (!(await this.roomAllowed(connection, room))) {
        connection.rooms.delete(room);
        await this.prisma.presenciaSala.deleteMany({
          where: { conexion: connection.id, sala: room },
        });
        this.send(connection, 'acceso:revocado', { room });
      }
    return true;
  }
  private async message(connection: Connection, raw: RawData) {
    const now = Date.now();
    if (!(await this.authenticate(connection))) return;
    const value: unknown = JSON.parse(
      (Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw)
      ).toString(),
    );
    if (!value || typeof value !== 'object') return;
    const { event, data } = value as {
      event: unknown;
      data?: { type?: unknown; id?: unknown };
    };
    if (
      !data ||
      !['publicacion', 'grupo'].includes(String(data.type)) ||
      typeof data.id !== 'string'
    )
      return;
    const room = `${String(data.type)}:${parsePostId(data.id)}`;
    if (event === 'sala:salir') {
      connection.rooms.delete(room);
      await this.prisma.presenciaSala.deleteMany({
        where: { conexion: connection.id, sala: room },
      });
      return;
    }
    if (
      event !== 'sala:unirse' ||
      connection.rooms.size >= 8 ||
      !(await this.roomAllowed(connection, room))
    ) {
      this.send(connection, 'acceso:revocado', { room });
      return;
    }
    connection.rooms.add(room);
    await this.prisma.presenciaSala.upsert({
      where: { conexion_sala: { conexion: connection.id, sala: room } },
      create: {
        conexion: connection.id,
        sala: room,
        id_usuario: connection.user.id,
        vence: new Date(now + 30000),
      },
      update: { vence: new Date(now + 30000) },
    });
    this.send(connection, 'sala:unirse', { room });
    await this.presence(room);
  }
  private send(connection: Connection, event: string, data: unknown) {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    if (connection.socket.bufferedAmount > 65536) {
      connection.socket.close(1013, 'Slow connection');
      return;
    }
    connection.socket.send(JSON.stringify({ event, data }));
  }
  private async flush() {
    const changes = [...this.changes.values()];
    this.changes.clear();
    try {
      for (const connection of this.connections.values()) {
        if (!(await this.revalidate(connection))) continue;
        for (const change of changes) {
          if (
            change.event === 'acceso:actualizado' &&
            change.userId === connection.user.id.toString()
          )
            this.send(connection, 'acceso:actualizado', { reload: true });
          if (
            change.event.startsWith('notificacion:') &&
            change.userId === connection.user.id.toString()
          )
            this.send(connection, change.event, { reload: true });
          const rooms = [
            change.postId ? `publicacion:${change.postId}` : '',
            change.groupId ? `grupo:${change.groupId}` : '',
          ].filter((room) => connection.rooms.has(room));
          for (const room of rooms) {
            if (
              [
                'publicacion:nueva',
                'publicacion:actualizada',
                'comentario:nuevo',
                'comentario:retirado',
                'acceso:actualizado',
              ].includes(change.event)
            )
              this.send(connection, change.event, { room, reload: true });
          }
        }
      }
      for (const room of new Set(
        changes
          .filter((c) => c.event === 'presencia:actualizada')
          .map((c) => c.room!),
      ))
        await this.presence(room);
    } catch {
      this.logger.warn(
        'Realtime delivery interrupted; clients reconcile through REST',
      );
    }
  }
  private async presence(room: string) {
    const rows = await this.prisma.presenciaSala.findMany({
      where: { sala: room, vence: { gt: new Date() } },
      select: { id_usuario: true },
      distinct: ['id_usuario'],
    });
    for (const connection of this.connections.values())
      if (
        connection.rooms.has(room) &&
        (await this.revalidate(connection)) &&
        connection.rooms.has(room)
      )
        this.send(connection, 'presencia:conectados', {
          room,
          count: rows.length,
        });
  }
  private async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      for (const connection of this.connections.values()) {
        if (!connection.alive) {
          connection.socket.terminate();
          continue;
        }
        connection.alive = false;
        connection.socket.ping();
        if (!(await this.revalidate(connection))) continue;
        await this.prisma.presenciaSala.updateMany({
          where: { conexion: connection.id },
          data: { vence: new Date(Date.now() + 30000) },
        });
      }
      await this.prisma.presenciaSala.deleteMany({
        where: { vence: { lte: new Date() } },
      });
      for (const room of new Set(
        [...this.connections.values()].flatMap((c) => [...c.rooms]),
      ))
        await this.presence(room);
    } catch {
      for (const connection of this.connections.values())
        connection.socket.close(1012, 'Reconnecting');
    } finally {
      this.ticking = false;
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    this.http?.off('upgrade', this.upgrade);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    const ids = [...this.connections.values()].map((c) => c.id);
    for (const connection of this.connections.values())
      connection.socket.terminate();
    await this.prisma.presenciaSala
      .deleteMany({ where: { conexion: { in: ids } } })
      .catch(() => undefined);
    await this.listener?.end().catch(() => undefined);
    this.server.close();
  }
}
