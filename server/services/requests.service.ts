import { deps } from '../container';
import type { RequestType, RoomRequest } from '../domain/types';
import { ConflictError, NotFoundError } from '../errors';
import { requireMember, requireOwner } from './access';
import { requestDto } from './dto';
import { advanceFrom } from './playback.service';

/** K3 (skip the current track) and K4 (remove someone else's track) go through the owner. K6: a repeat returns the open one */
export async function createRequest(code: string, type: RequestType, itemId: string) {
  const { room, user } = await requireMember(code);
  const { repos, events } = deps();
  const result = await repos.transaction(async () => {
    const item = await repos.queue.find(itemId);
    if (!item || item.roomId !== room.id || (item.status !== 'queued' && item.status !== 'playing')) {
      throw new NotFoundError('Цього треку вже немає в черзі');
    }
    if (type === 'skip' && item.status !== 'playing') throw new ConflictError('REQUEST_OBSOLETE', 'Цей трек уже не грає');
    return repos.requests.createOrGetPending({ roomId: room.id, queueItemId: itemId, type, requestedBy: user.id });
  });
  if (result.created) events.roomChanged(room.code, 'request-created');
  return { status: result.created ? 201 : 200, body: requestDto(result.request) };
}

const DECIDED_STATUS = { approve: 'approved', reject: 'rejected' } as const;

/**
 * K7: the same decision twice is a no-op 200; the opposite one is a conflict.
 * K8: a request whose track already left the queue becomes obsolete and can't be approved.
 */
export async function decide(code: string, requestId: string, decision: 'approve' | 'reject') {
  const { room, user } = await requireOwner(code);
  const { repos, events } = deps();

  const outcome = await repos.transaction(async (): Promise<{ req: RoomRequest; changed: boolean }> => {
    const req = await repos.requests.find(requestId);
    if (!req || req.roomId !== room.id) throw new NotFoundError('Такого запиту немає');
    if (req.status !== 'pending') return { req, changed: false };

    if (decision === 'reject') return { req: (await repos.requests.decide(req.id, 'rejected', user.id))!, changed: true };

    const item = await repos.queue.find(req.queueItemId);
    const stillThere = item && (req.type === 'skip' ? item.status === 'playing' : item.status === 'queued' || item.status === 'playing');
    if (!stillThere) return { req: (await repos.requests.decide(req.id, 'obsolete', null))!, changed: true };

    const approved = (await repos.requests.decide(req.id, 'approved', user.id))!;
    if (item.status === 'playing') await advanceFrom(room, item.id, req.type === 'remove' ? 'removed' : 'played');
    else {
      await repos.queue.setStatus(item.id, 'removed');
      await repos.requests.obsoletePendingFor(item.id);
    }
    return { req: approved, changed: true };
  });

  if (outcome.changed) events.roomChanged(room.code, 'request-decided');
  const { req } = outcome;
  if (req.status === 'obsolete') throw new ConflictError('REQUEST_OBSOLETE', 'Трек уже не в черзі');
  if (req.status !== DECIDED_STATUS[decision]) {
    throw new ConflictError('REQUEST_ALREADY_DECIDED', 'Цей запит уже вирішено інакше');
  }
  return requestDto(req);
}
