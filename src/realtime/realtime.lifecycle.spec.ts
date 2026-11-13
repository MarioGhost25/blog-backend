import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PostsRepository } from '../posts/posts.repository';
import { PostsService } from '../posts/posts.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeRepository } from './realtime.repository';

describe('RealtimeGateway lifecycle', () => {
  it('can shut down before initialization when application startup fails', async () => {
    const removePresence = jest
      .fn()
      .mockRejectedValue(new Error('DB unavailable'));
    const gateway = new RealtimeGateway(
      {} as HttpAdapterHost,
      new ConfigService(),
      {} as JwtStrategy,
      { removePresence } as unknown as RealtimeRepository,
      {} as PostsService,
      {} as PostsRepository,
    );

    await expect(gateway.onModuleDestroy()).resolves.toBeUndefined();
  });
});
