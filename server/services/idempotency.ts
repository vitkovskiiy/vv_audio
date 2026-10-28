import { createHash } from 'node:crypto';
import { deps } from '../container';
import { log } from '../context';
import { IdempotencyKeyReusedError, ValidationError } from '../errors';
import { requireUser } from './access';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

const KEY_RE = /^[\w-]{8,128}$/;

/**
 * Runs a creating operation at most once per Idempotency-Key.
 * The key is stored in the same transaction as the operation's effect, so a crash leaves both or neither:
 * a client that retries after a lost response gets the original answer instead of a duplicate.
 */
export async function idempotent<T>(
  key: string | undefined,
  scope: string,
  request: unknown,
  status: number,
  fn: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const { repos } = deps();
  if (key === undefined) return repos.transaction(async () => ({ status, body: await fn(), replayed: false }));
  if (!KEY_RE.test(key)) throw new ValidationError('Idempotency-Key: 8–128 символів, літери, цифри, «-» або «_»');

  const user = requireUser();
  const requestHash = createHash('sha256').update(scope).update(JSON.stringify(request ?? null)).digest('hex');

  return repos.transaction(async () => {
    const existing = await repos.idempotency.find(user.id, key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
      log().info({ idempotencyKey: key }, 'replaying stored response');
      return { status: existing.statusCode, body: existing.response as T, replayed: true };
    }
    const body = await fn();
    await repos.idempotency.save({ userId: user.id, key, requestHash, statusCode: status, response: body });
    return { status, body, replayed: false };
  });
}
