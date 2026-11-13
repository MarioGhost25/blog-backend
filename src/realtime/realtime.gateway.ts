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
import type { Server } from 'node:http';
import { Server as SocketServer, Socket } from 'socket.io';
import { Client } from 'pg';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { RealtimeRepository } from './realtime.repository';
import { PostsService } from '../posts/posts.service';
import { PostsRepository } from '../posts/posts.repository';
import { parsePostId } from '../posts/utils/post-id';
interface Connection {
  id: string;
  socket: Socket;
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
  private server!: SocketServer;
  private readonly connections = new Map<Socket, Connection>();
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
  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly config: ConfigService,
    private readonly strategy: JwtStrategy,
    private readonly presenceRepository: RealtimeRepository,
    private readonly posts: PostsService,
    private readonly repository: PostsRepository,
  ) {}
  async onModuleInit() {
    this.http = this.adapter.httpAdapter.getHttpServer() as Server;
    this.server = new SocketServer(this.http, {
      maxHttpBufferSize: 4096,
      cors: {
        origin:
          this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
        credentials: true,
      },
      allowRequest: (request, done) =>
        done(
          null,
          request.headers.origin ===
            new URL(
              this.config.get<string>('FRONTEND_URL') ??
                'http://localhost:3000',
            ).origin,
        ),
    });
    const namespace = this.server.of('/realtime');
    namespace.use((socket, next) => {
      void this.accept(socket).then(
        () => next(),
        () => next(new Error('Unauthorized')),
      );
    });
    namespace.on('connection', (socket) => {
      const connection = socket.data.connection as Connection;
      this.connections.set(socket, connection);
      void socket.join(`user:${connection.user.id}`);
      for (const event of ['room:join', 'room:leave'])
        socket.on(event, (data) => {
          const now = Date.now();
          if (now - connection.since > 60000) {
            connection.since = now;
            connection.messages = 0;
          }
          if (++connection.messages > 30) {
            socket.disconnect(true);
            return;
          }
          connection.queue = connection.queue
            .then(() => this.message(connection, { event, data }))
            .catch(() => {
              this.send(connection, 'error', { message: 'Invalid request' });
            });
        });
      socket.on('disconnect', () => {
        this.connections.delete(socket);
        void this.presenceRepository
          .removePresence({ where: { conexion: connection.id } })
          .catch(() => undefined);
      });
      this.send(connection, 'connection:ready', {});
    });
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
        connection.socket.disconnect(true);
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
        change.event =
          (
            {
              'publicacion:nueva': 'post:new',
              'publicacion:actualizada': 'post:updated',
              'comentario:nuevo': 'comment:new',
              'comentario:retirado': 'comment:removed',
              'acceso:actualizado': 'access:updated',
              'notificacion:nueva': 'notification:new',
              'notificacion:contador': 'notification:count',
              'presencia:actualizada': 'presence:updated',
              'presencia:conectados': 'presence:connected',
              'cuenta:suspendida': 'account:suspended',
              'acceso:revocado': 'access:revoked',
              'sala:unirse': 'room:join',
              'sala:salir': 'room:leave',
            } as Record<string, string>
          )[change.event] ?? change.event;
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
  private async accept(socket: Socket) {
    const now = Date.now();
    for (const [key, value] of this.upgrades)
      if (value.until <= now) this.upgrades.delete(key);
    const address = socket.handshake.address;
    const bucket = this.upgrades.get(address) ?? {
      count: 0,
      until: now + 60000,
    };
    if (++bucket.count > 120 || this.upgrades.size >= 10000)
      throw new Error('Connection limit');
    this.upgrades.set(address, bucket);
    const token = socket.handshake.headers.cookie?.match(
      /(?:^|;\s*)jwt=([A-Za-z0-9._-]+)(?:;|$)/,
    )?.[1];
    if (!token || this.connections.size >= 1000)
      throw new Error('Unauthorized');
    const jwt = new JwtService({
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
    });
    const claims: unknown = await jwt.verifyAsync(token, {
      algorithms: ['HS256'],
      maxAge: '60m',
    });
    const user = await this.strategy.validate(claims);
    if (
      [...this.connections.values()].filter((c) => c.user.id === user.id)
        .length >= 12
    )
      throw new Error('Connection limit');
    socket.data.connection = {
      id: randomUUID(),
      socket,
      user,
      claims,
      expires: (claims as { exp: number }).exp * 1000,
      rooms: new Set<string>(),
      alive: true,
      messages: 0,
      since: Date.now(),
      queue: Promise.resolve(),
    } satisfies Connection;
  }
  private async authenticate(connection: Connection) {
    if (connection.expires <= Date.now()) {
      connection.socket.disconnect(true);
      return false;
    }
    try {
      connection.user = await this.strategy.validate(connection.claims);
      return true;
    } catch {
      this.send(connection, 'account:suspended', {});
      connection.socket.disconnect(true);
      return false;
    }
  }
  private async roomAllowed(connection: Connection, room: string) {
    const [type, id] = room.split(':');
    try {
      const value = parsePostId(id);
      if (type === 'post') {
        await this.posts.findOne(value, connection.user);
        return true;
      }
      if (type === 'group')
        return (
          Boolean(
            await this.presenceRepository.countGroups({
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
        await connection.socket.leave(room);
        await this.presenceRepository.removePresence({
          where: { conexion: connection.id, sala: room },
        });
        this.send(connection, 'access:revoked', { room });
      }
    return true;
  }
  private async message(connection: Connection, value: unknown) {
    const now = Date.now();
    if (!(await this.authenticate(connection))) return;
    if (!value || typeof value !== 'object') return;
    const { event, data } = value as {
      event: unknown;
      data?: { type?: unknown; id?: unknown };
    };
    if (
      !data ||
      !['post', 'group'].includes(String(data.type)) ||
      typeof data.id !== 'string'
    )
      return;
    const room = `${String(data.type)}:${parsePostId(data.id)}`;
    if (event === 'room:leave') {
      connection.rooms.delete(room);
      await connection.socket.leave(room);
      await this.presenceRepository.removePresence({
        where: { conexion: connection.id, sala: room },
      });
      return;
    }
    if (
      event !== 'room:join' ||
      connection.rooms.size >= 8 ||
      !(await this.roomAllowed(connection, room))
    ) {
      this.send(connection, 'access:revoked', { room });
      return;
    }
    connection.rooms.add(room);
    await connection.socket.join(room);
    await this.presenceRepository.joinPresence({
      where: { conexion_sala: { conexion: connection.id, sala: room } },
      create: {
        conexion: connection.id,
        sala: room,
        id_usuario: connection.user.id,
        vence: new Date(now + 30000),
      },
      update: { vence: new Date(now + 30000) },
    });
    this.send(connection, 'room:join', { room });
    await this.presence(room);
  }
  private send(connection: Connection, event: string, data: unknown) {
    if (connection.socket.connected) connection.socket.emit(event, data);
  }
  private async flush() {
    const changes = [...this.changes.values()];
    this.changes.clear();
    try {
      for (const connection of this.connections.values()) {
        if (!(await this.revalidate(connection))) continue;
        for (const change of changes) {
          if (
            change.event === 'access:updated' &&
            change.userId === connection.user.id.toString()
          )
            this.send(connection, 'access:updated', { reload: true });
          if (
            change.event.startsWith('notification:') &&
            change.userId === connection.user.id.toString()
          ) {
            this.send(connection, change.event, { reload: true });
            if (change.event === 'notification:new')
              this.send(connection, 'notification:count', { reload: true });
          }
          const rooms = [
            change.postId ? `post:${change.postId}` : '',
            change.groupId ? `group:${change.groupId}` : '',
          ].filter((room) => connection.rooms.has(room));
          for (const room of rooms) {
            if (
              [
                'post:new',
                'post:updated',
                'comment:new',
                'comment:removed',
                'access:updated',
              ].includes(change.event)
            )
              this.send(connection, change.event, { room, reload: true });
          }
        }
      }
      for (const room of new Set(
        changes
          .filter((c) => c.event === 'presence:updated')
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
    const rows = await this.presenceRepository.findPresence({
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
        this.send(connection, 'presence:connected', {
          room,
          count: rows.length,
        });
  }
  private async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      for (const connection of this.connections.values()) {
        if (!(await this.revalidate(connection))) continue;
        await this.presenceRepository.refreshPresence({
          where: { conexion: connection.id },
          data: { vence: new Date(Date.now() + 30000) },
        });
      }
      await this.presenceRepository.removePresence({
        where: { vence: { lte: new Date() } },
      });
      for (const room of new Set(
        [...this.connections.values()].flatMap((c) => [...c.rooms]),
      ))
        await this.presence(room);
    } catch {
      for (const connection of this.connections.values())
        connection.socket.disconnect(true);
    } finally {
      this.ticking = false;
    }
  }
  async onModuleDestroy() {
    this.stopped = true;

    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    const ids = [...this.connections.values()].map((c) => c.id);
    for (const connection of this.connections.values())
      connection.socket.disconnect(true);
    await this.presenceRepository
      .removePresence({ where: { conexion: { in: ids } } })
      .catch(() => undefined);
    await this.listener?.end().catch(() => undefined);
    this.server.close();
  }
}
