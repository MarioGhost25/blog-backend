import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { identifyOperation, operationKey } from './post-operation';

const key = 'a5aca32f-fc05-4e31-b744-593f88c54b0e';
describe('publication operation identity', () => {
  it('rejects invalid keys and another account before accessing persistence', () => {
    for (const invalid of ['', key.toUpperCase(), `${key}\n`, 'not-a-uuid']) {
      expect(() => operationKey(invalid)).toThrow(BadRequestException);
    }
    for (const owner of [undefined, '43', '042']) {
      expect(() =>
        identifyOperation(42n, key, owner, 'POST', undefined, {}),
      ).toThrow(ForbiddenException);
    }
  });
  it('fingerprints method, post, version and body regardless of property order', () => {
    const first = identifyOperation(42n, key, '42', 'PATCH', 90n, {
      title: 'Draft',
      version: 1,
    });
    const reordered = identifyOperation(42n, key, '42', 'PATCH', 90n, {
      version: 1,
      title: 'Draft',
    });
    expect(first.fingerprint).toBe(reordered.fingerprint);
    for (const changed of [
      identifyOperation(42n, key, '42', 'PATCH', 91n, {
        title: 'Draft',
        version: 1,
      }),
      identifyOperation(42n, key, '42', 'PATCH', 90n, {
        title: 'Changed',
        version: 1,
      }),
      identifyOperation(42n, key, '42', 'PATCH', 90n, {
        title: 'Draft',
        version: 2,
      }),
      identifyOperation(42n, key, '42', 'DELETE', 90n, {
        title: 'Draft',
        version: 1,
      }),
    ])
      expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      JSON.stringify({ ...first, userId: first.userId.toString() }),
    ).not.toContain('Draft');
  });
});
