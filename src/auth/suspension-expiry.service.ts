import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { reactivateExpiredAccounts } from './account-suspension';

@Injectable()
export class SuspensionExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SuspensionExpiryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 5 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      await reactivateExpiredAccounts(this.prisma);
    } catch {
      this.logger.warn('Suspension expiry sweep failed; next sweep will retry');
    } finally {
      this.running = false;
    }
  }
}
