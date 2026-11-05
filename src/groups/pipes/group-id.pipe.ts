import { Injectable, PipeTransform } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { parseGroupId } from '../utils/group-id';

@Injectable()
export class GroupIdPipe implements PipeTransform<unknown, bigint> {
  transform(value: unknown, metadata: ArgumentMetadata): bigint {
    return parseGroupId(value, metadata.data ?? 'id');
  }
}
