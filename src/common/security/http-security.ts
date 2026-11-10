import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
  type INestApplication,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type TracedRequest = Request & { requestId?: string };
const logger = new Logger('HttpAudit');
const codes: Record<number, string> = {
  400: 'ValidationError',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  410: 'Gone',
  413: 'PayloadTooLarge',
  415: 'UnsupportedMediaType',
  429: 'RateLimited',
  502: 'UpstreamError',
  503: 'ServiceUnavailable',
  504: 'UpstreamTimeout',
};
const explicitCodes = new Set([
  'OperationOwnerChanged',
  'OperationKeyConflict',
  'AccountSuspended',
  'MediaStorageNotConfigured',
  'MediaStorageUnavailable',
  'RateLimited',
]);

function routePattern(request: Request): string {
  // Never fall back to the actual URL: unmatched paths can contain tokens or email addresses.
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? route.path : '<unmatched>';
}

export function auditEvent(
  request: Request,
  status: number,
  requestId: string,
) {
  const user: unknown = request.user;
  const actorId =
    user &&
    typeof user === 'object' &&
    'id' in user &&
    typeof user.id === 'bigint'
      ? user.id.toString()
      : undefined;
  return {
    event: 'http.request',
    method: request.method,
    route: routePattern(request),
    status,
    requestId,
    ...(actorId ? { actorId } : {}),
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<TracedRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500,
      code = 'InternalError';
    let message: string | string[] = 'An internal error occurred';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codes[status] ?? 'HttpError';
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        const value = body as { message?: unknown; error?: unknown };
        if (typeof value.message === 'string') message = value.message;
        else if (
          Array.isArray(value.message) &&
          value.message.every((v): v is string => typeof v === 'string')
        )
          message = value.message;
        if (typeof value.error === 'string' && explicitCodes.has(value.error))
          code = value.error;
      }
      if (status === 403 && message === 'The account is suspended')
        code = 'AccountSuspended';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        code = 'UniqueConflict';
        message = 'A resource with those values already exists';
      } else if (exception.code === 'P2025') {
        status = 404;
        code = 'NotFound';
        message = 'Resource not found';
      }
      // Connection failures, SQL syntax and other constraints are not conflicts.
    }
    const requestId = request.requestId ?? randomUUID();
    response.setHeader('X-Request-ID', requestId);
    response.status(status).json({
      statusCode: status,
      error: code,
      message,
      idCorrelacion: requestId,
      ruta: routePattern(request),
      fecha: new Date().toISOString(),
    });
  }
}

export function configureHttpSecurity(app: INestApplication) {
  app.use((request: TracedRequest, response: Response, next: NextFunction) => {
    request.requestId = randomUUID();
    response.setHeader('X-Request-ID', request.requestId);
    response.once('finish', () => {
      // Audit mutations and errors, including rejected guards. No bodies, query, cookies, IP or tokens.
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
        response.statusCode >= 400
      )
        logger.log(
          JSON.stringify(
            auditEvent(request, response.statusCode, request.requestId!),
          ),
        );
    });
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
