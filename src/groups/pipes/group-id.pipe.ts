import { Injectable, PipeTransform } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { parseGroupId } from '../utils/group-id';

@Injectable()
export class GroupIdPipe implements PipeTransform<unknown, bigint> {
  //PipeTransform is a generic<T, R> T=Type, R=Return
  transform(value: unknown, metadata: ArgumentMetadata): bigint {
    //Every pipe must implement the transform() method to fulfil
    return parseGroupId(value, metadata.data ?? 'id');
  }
}
