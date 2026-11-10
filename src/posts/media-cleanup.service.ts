import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentStorageService } from './attachment-storage.service';

@Injectable()
export class MediaCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaCleanupService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
  ) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async begin(type: 'image' | 'document') {
    const publicId = `posts/${randomUUID()}${type === 'document' ? '.pdf' : ''}`;
    await this.prisma.activoMultimedia.create({
      data: {
        public_id: publicId,
        tipo: type,
        entrega: 'authenticated',
        // Longer than all provider timeouts/retries. Also recovers a process crash.
        siguiente_intento: new Date(Date.now() + 10 * 60000),
      },
    });
    return publicId;
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.activoMultimedia.findMany({
        where: {
          estado: { in: ['pending', 'deleting'] },
          siguiente_intento: { lte: new Date() },
        },
        orderBy: { siguiente_intento: 'asc' },
        take: 30,
      });
      for (const row of rows) await this.cleanup(row.public_id);
    } catch {
      this.logger.warn('Media cleanup will retry on the next sweep');
    } finally {
      this.running = false;
    }
  }

  async cleanup(publicId: string) {
    const row = await this.prisma.activoMultimedia.findUnique({
      where: { public_id: publicId },
    });
    if (!row || row.estado === 'linked' || row.siguiente_intento > new Date())
      return;
    const claim = await this.prisma.activoMultimedia.updateMany({
      where: {
        public_id: publicId,
        estado: row.estado,
        siguiente_intento: row.siguiente_intento,
      },
      data: {
        estado: 'deleting',
        intentos: { increment: 1 },
        siguiente_intento: new Date(Date.now() + 10 * 60000),
      },
    });
    if (claim.count !== 1) return; // Another instance owns the lease.
    try {
      await this.storage.delete(row.public_id, row.tipo, row.entrega);
      await this.prisma.activoMultimedia.delete({
        where: { public_id: publicId },
      });
    } catch {
      await this.prisma.activoMultimedia.update({
        where: { public_id: publicId },
        data: {
          siguiente_intento: new Date(
            Date.now() +
              Math.min(86400000, 60000 * 2 ** Math.min(row.intentos, 10)),
          ),
        },
      });
      this.logger.warn('Media deletion queued for retry');
    }
  }
}
