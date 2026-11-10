import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

export function normalizeIp(value: string): string | undefined {
  if (!isIP(value)) return;
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4)
    return value.slice(7);
  return isIP(value) === 6
    ? new URL(`http://[${value}]/`).hostname.slice(1, -1)
    : value;
}

/** A forwarding header is trusted only when the BFF signs IP, method, URL and time. */
export function clientIdentity(
  request: Request,
  secret?: string,
  now = Date.now(),
): string {
  const ip = request.get('x-blog-client-ip');
  const timestamp = request.get('x-blog-client-time');
  const signature = request.get('x-blog-client-signature');
  if (
    secret &&
    secret.length >= 32 &&
    ip &&
    normalizeIp(ip) === ip &&
    timestamp &&
    /^\d{13}$/.test(timestamp) &&
    signature &&
    /^[a-f0-9]{64}$/.test(signature) &&
    Math.abs(now - Number(timestamp)) <= 30000
  ) {
    const payload = `v1\n${ip}\n${timestamp}\n${request.method.toUpperCase()}\n${request.originalUrl}`;
    const expected = createHmac('sha256', secret).update(payload).digest();
    if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return ip;
  }
  // Deliberately ignore arbitrary X-Forwarded-For and Express trust-proxy settings.
  return normalizeIp(request.socket.remoteAddress ?? '') ?? 'unknown';
}
