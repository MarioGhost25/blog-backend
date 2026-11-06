import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

function fieldMessages(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const constraints = error.constraints ?? {};
    let message: string | undefined;
    if (constraints.whitelistValidation) {
      message = `${field} is not accepted by this endpoint. Remove it from the request.`;
    } else if (Object.keys(constraints).length) {
      if (error.value === undefined || error.value === null) {
        message =
          constraints.isDefined ??
          `${field} is required. Include it in the request.`;
      } else if (constraints.isArray) {
        message = `${field} must be an array, for example [1, 2].`;
      } else if (constraints.isInt) {
        message = Array.isArray(error.value)
          ? `${field} must contain only whole numbers without quotes, for example [1, 2].`
          : `${field} must be a whole number, for example 1. In a JSON body, send it without quotes.`;
      } else if (constraints.isString) {
        message = `${field} must be text.`;
      } else if (constraints.isBoolean) {
        message = constraints.isBoolean;
      } else {
        message =
          constraints.isEnum ??
          constraints.isIn ??
          constraints.isEmail ??
          constraints.isUrl ??
          Object.values(constraints)[0];
      }
    }
    return [
      ...(message ? [message] : []),
      ...fieldMessages(error.children ?? [], field),
    ];
  });
}

export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: fieldMessages(errors),
      }),
  });
}
