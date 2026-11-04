import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { registerDecorator } from 'class-validator';

export function isGroupId(value: unknown): value is string | number {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0;
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}

// JSON numbers are accepted only when exact; decimal strings support the full SQL bigint range.
export function IsGroupId(): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isGroupId',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate: isGroupId,
        defaultMessage: () =>
          'El ID debe ser un entero positivo seguro o una cadena decimal de 64 bits',
      },
    });
}

export function parseGroupId(value: unknown): bigint {
  if (!isGroupId(value))
    throw new BadRequestException('Identificador inválido');
  return BigInt(value);
}

@Injectable()
export class GroupIdPipe implements PipeTransform<unknown, bigint> {
  transform(value: unknown): bigint {
    return parseGroupId(value);
  }
}
