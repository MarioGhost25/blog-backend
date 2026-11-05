import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export interface FieldError {
  field: string;
  code: 'required' | 'unknown_field' | 'invalid_value';
  messages: string[];
}

function fieldErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? parent + '.' + error.property : error.property;
    const constraints = error.constraints ?? {};
    const unknown = 'whitelistValidation' in constraints;
    const missing =
      !unknown && (error.value === undefined || error.value === null);
    const own: FieldError[] = Object.keys(constraints).length
      ? [
          {
            field,
            code: unknown
              ? 'unknown_field'
              : missing
                ? 'required'
                : 'invalid_value',
            messages: unknown
              ? [
                  field +
                    ' is not an accepted field. Check the request fields in the API documentation.',
                ]
              : missing
                ? [field + ' is required and cannot be null.']
                : Object.values(constraints),
          },
        ]
      : [];
    return [...own, ...fieldErrors(error.children ?? [], field)];
  });
}

export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = fieldErrors(errors);
      return new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: details.flatMap((detail) => detail.messages),
        details,
      });
    },
  });
}
