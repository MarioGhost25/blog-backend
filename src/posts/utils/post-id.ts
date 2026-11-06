import { BadRequestException } from '@nestjs/common';

export function parsePostId(value: string | number): bigint {
  if (
    (typeof value === 'number' && !Number.isSafeInteger(value)) ||
    !/^[1-9]\d{0,18}$/.test(String(value)) ||
    BigInt(value) > 9223372036854775807n
  ) {
    throw new BadRequestException(
      'ID must be a positive integer within the supported range',
    );
  }
  return BigInt(value);
}
