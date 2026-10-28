import type { ApiErrorBody } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: string;
  body?: unknown;
  /** creating calls send one; a network failure is retried once with the same key, so nothing is created twice */
  idempotent?: boolean;
}

async function send(path: string, method: string, body: unknown, key?: string): Promise<Response> {
  return fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** JSON call against our server; throws ApiError with the server's code and message */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const key = opts.idempotent ? crypto.randomUUID() : undefined;
  let res: Response;
  try {
    res = await send(path, method, opts.body, key);
  } catch {
    if (!key) throw new ApiError(0, 'NETWORK', 'Сервер не відповідає. Перевірте з’єднання');
    try {
      res = await send(path, method, opts.body, key);
    } catch {
      throw new ApiError(0, 'NETWORK', 'Сервер не відповідає. Перевірте з’єднання');
    }
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody).error;
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/me') window.dispatchEvent(new Event('vv-unauthorized'));
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Помилка ${res.status}`);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Щось пішло не так');
