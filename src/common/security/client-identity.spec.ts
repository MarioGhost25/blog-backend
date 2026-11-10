import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { clientIdentity, normalizeIp } from './client-identity';
import { auditEvent } from './http-security';

describe('forwarded identity and safe audit', () => {
  const secret = 'synthetic-identity-secret-at-least-32-chars';
  const now = 1794170000000;
  function signed(ip = '192.0.2.1', time = now): Request {
    const headers: Record<string, string> = {
      'x-blog-client-ip': ip,
      'x-blog-client-time': String(time),
      'x-blog-client-signature': createHmac('sha256', secret)
        .update(`v1\n${ip}\n${time}\nPOST\n/api/v1/auth/login`)
        .digest('hex'),
    };
    return {
      get: (key: string) => headers[key],
      method: 'POST',
      originalUrl: '/api/v1/auth/login',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
  }
  it('accepts a fresh signature but rejects expiry, altered path, method and secret', () => {
    expect(clientIdentity(signed(), secret, now)).toBe('192.0.2.1');
    expect(clientIdentity(signed('192.0.2.1', now - 31000), secret, now)).toBe(
      '127.0.0.1',
    );
    const path = signed();
    path.originalUrl = '/api/v1/posts';
    expect(clientIdentity(path, secret, now)).toBe('127.0.0.1');
    const method = signed();
    method.method = 'GET';
    expect(clientIdentity(method, secret, now)).toBe('127.0.0.1');
    expect(clientIdentity(signed(), `${secret}!`, now)).toBe('127.0.0.1');
    expect(clientIdentity(signed(), undefined, now)).toBe('127.0.0.1');
  });
  it('validates IPs and canonicalizes supported IPv6 forms', () => {
    expect(normalizeIp('192.0.2.1, 127.0.0.1')).toBeUndefined();
    expect(normalizeIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizeIp('2001:0db8::1')).toBe('2001:db8::1');
  });
  it('audits route templates without actual paths, query, headers or body', () => {
    const request = {
      method: 'POST',
      route: { path: '/api/v1/auth/reset-password' },
      originalUrl: '/private-token?email=secret',
      body: { token: 'secret', newPassword: 'secret' },
      headers: { cookie: 'secret' },
    } as unknown as Request;
    const event = auditEvent(request, 410, 'synthetic-request-id');
    expect(event.route).toBe('/api/v1/auth/reset-password');
    expect(JSON.stringify(event)).not.toContain('secret');
    delete request.route;
    expect(auditEvent(request, 404, 'id').route).toBe('<unmatched>');
  });
});
