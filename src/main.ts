import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createApiValidationPipe } from './common/validation/api-validation.pipe';
import { configureHttpSecurity } from './common/security/http-security';

Object.defineProperty(BigInt.prototype, 'toJSON', {
  configurable: true,
  writable: true,
  value: function (this: bigint): number {
    return Number(this);
  },
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureHttpSecurity(app);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(createApiValidationPipe());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  try {
    await app.listen(port);
    new Logger('Bootstrap').log(
      `Listening on port ${port} (PID ${process.pid})`,
    );
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
