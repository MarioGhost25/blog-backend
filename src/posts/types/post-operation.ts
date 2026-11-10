import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type PostMethod = 'POST' | 'PATCH' | 'DELETE';
export type OperationInput = {
  userId: bigint;
  key: string;
  method: PostMethod;
  fingerprint: string;
};

export function operationKey(value: string): string {
  if (
    value.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new BadRequestException(
      'Idempotency-Key must be a canonical UUID v4',
    );
  }
  return value;
}

export function identifyOperation(
  userId: bigint,
  key: string,
  expectedOwner: string | undefined,
  method: PostMethod,
  postId: bigint | undefined,
  body: object,
): OperationInput {
  operationKey(key);
  if (expectedOwner !== userId.toString()) {
    throw new ForbiddenException({
      error: 'OperationOwnerChanged',
      message: 'The publication operation belongs to another session',
    });
  }
  // DTO fields are primitive. Sort them so JSON property order is irrelevant.
  const ordered = Object.fromEntries(
    Object.entries(body).sort(([a], [b]) => a.localeCompare(b)),
  );
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        method,
        postId: postId?.toString() ?? null,
        body: ordered,
      }),
    )
    .digest('hex');
  return { userId, key, method, fingerprint };
}
