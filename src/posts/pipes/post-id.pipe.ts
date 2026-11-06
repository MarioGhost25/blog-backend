import { Injectable, PipeTransform } from '@nestjs/common';
import { parsePostId } from '../utils/post-id';

@Injectable()
export class PostIdPipe implements PipeTransform<string, bigint> {
  transform(value: string): bigint {
    return parsePostId(value);
  }
}
