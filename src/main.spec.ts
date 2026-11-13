import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

jest.mock('./app.module', () => ({ AppModule: class {} }));
jest.mock('./common/security/http-security', () => ({
  configureHttpSecurity: jest.fn(),
}));

describe('bootstrap failure', () => {
  it('reports the original startup error even when cleanup rejects', async () => {
    const startup = new Error('synthetic startup failure');
    const close = jest.fn().mockRejectedValue(new Error('cleanup failure'));
    const app = {
      setGlobalPrefix: jest.fn(),
      enableShutdownHooks: jest.fn(),
      use: jest.fn(),
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
      listen: jest.fn().mockRejectedValue(startup),
      close,
    };
    const originalExitCode = process.exitCode;
    const create = jest
      .spyOn(NestFactory, 'create')
      .mockResolvedValue(
        app as unknown as Awaited<ReturnType<typeof NestFactory.create>>,
      );
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      await import('./main');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(close).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        'Application cleanup failed after startup error',
      );
      expect(error).toHaveBeenLastCalledWith(startup.stack);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
      create.mockRestore();
      error.mockRestore();
    }
  });
});
