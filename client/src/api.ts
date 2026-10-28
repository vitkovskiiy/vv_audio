/** JSON fetch against our server; throws the server's error message on failure. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new Error('Сервер не отвечает. Проверьте, что он запущен');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event('vv-unauthorized'));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as T;
}
