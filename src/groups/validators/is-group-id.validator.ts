import { registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { isGroupId } from '../utils/group-id';

// JSON numbers are accepted only when exact; decimal strings support the full SQL bigint range.
export function IsGroupId(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isGroupId',
      target: target.constructor,
      propertyName: String(propertyKey),
      options,
      validator: {
        validate: isGroupId,
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a safe positive integer or a positive 64-bit decimal string`,
      },
    });
}
