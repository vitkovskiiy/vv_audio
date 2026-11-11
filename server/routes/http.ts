import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'vv_session';

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  for (const part of request.headers.cookie?.split(';') ?? []) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, maxAgeSec: number) {
  const secure = request.protocol === 'https' ? '; Secure' : '';
  reply.header('set-cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function idempotencyKey(request: FastifyRequest): string | undefined {
  const v = request.headers['idempotency-key'];
  return Array.isArray(v) ? v[0] : v;
}

export const codeParams = {
  type: 'object',
  required: ['code'],
  properties: { code: { type: 'string', minLength: 1, maxLength: 12 } },
} as const;

export const uuid = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } as const;
