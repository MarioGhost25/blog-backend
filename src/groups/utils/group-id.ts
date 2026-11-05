import { BadRequestException } from '@nestjs/common';

export function isGroupId(value: unknown): value is string | number {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0;
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}

export function parseGroupId(value: unknown, field = 'id'): bigint {
  if (!isGroupId(value)) {
    const message =
      field +
      ' must be a positive integer ID (for example "12"), up to 9223372036854775807. Replace URL placeholders with real IDs.';
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: [message],
      details: [{ field, code: 'invalid_value', messages: [message] }],
    });
  }
  return BigInt(value);
}
