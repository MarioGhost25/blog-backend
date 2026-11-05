import { BadRequestException } from '@nestjs/common';

export function parseUserId(value: string, field = 'id'): bigint {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new BadRequestException(
      `${field} must be a valid positive integer ID`,
    );
  }
  return BigInt(value);
}
