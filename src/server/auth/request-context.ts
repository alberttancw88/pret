import 'server-only';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { headers } from 'next/headers';

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Request id, client IP and user agent for the audit context (AU9). */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || '';
  const rid = h.get('x-request-id') ?? h.get('x-vercel-id') ?? '';
  return {
    requestId: /^[0-9a-f-]{36}$/i.test(rid) ? rid : randomUUID(),
    ip: isIP(fwd) ? fwd : null,
    userAgent: h.get('user-agent')?.slice(0, 500) ?? null,
  };
}
