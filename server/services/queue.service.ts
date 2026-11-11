import { deps } from '../container';
import type { QueueEntry } from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { requireMember, requireOwner } from './access';
import { queueItemDto, trackDto } from './dto';
import { idempotent } from './idempotency';
import { parseLink, resolveTrack } from './metadata';
import { advanceFrom } from './playback.service';

/** K1: never more than this many premium tracks in a row after a manual move */
export const MAX_PREMIUM_RUN = 2;

/** K9: a retried request with the same Idempotency-Key returns the first answer and adds nothing */
export async function addTrack(code: string, url: string, idempotencyKey: string | undefined) {
  const { room, user } = await requireMember(code);
  const link = parseLink(url);
  const { repos, metadata, events } = deps();
  // K11: network first, outside the transaction
  const resolved = await resolveTrack(link, metadata);

  const result = await idempotent(idempotencyKey, `queue:add:${room.id}`, { url }, 201, async () => {
    await repos.queue.lockRoom(room.id);
    const track = await repos.tracks.upsert(resolved.track, !resolved.fallback);
    const item = await repos.queue.add({
      roomId: room.id,
      trackId: track.id,
      addedBy: user.id,
      isPremium: user.plan === 'premium',
      status: 'queued',
      locked: false,
    });
    // an empty room starts with this track as current (paused)
    await advanceFrom(room, null);
    await repos.messages.add({ roomId: room.id, userId: null, kind: 'system', text: `${user.username} додав(ла) «${track.title}»` });
    return { item: { id: item.id, track: trackDto(track), isPremium: item.isPremium }, metadataFallback: resolved.fallback };
  });
  if (!result.replayed) events.roomChanged(room.code, 'track-added');
  return result;
}

async function liveItem(roomId: string, itemId: string) {
  const item = await deps().repos.queue.find(itemId);
  if (!item || item.roomId !== roomId || (item.status !== 'queued' && item.status !== 'playing')) {
    throw new NotFoundError('Цього треку вже немає в черзі');
  }
  return item;
}

/** K4: the owner and the track's author remove at once; everyone else has to ask the owner */
export async function removeItem(code: string, itemId: string) {
  const { room, member, user } = await requireMember(code);
  const { repos, events } = deps();
  await repos.transaction(async () => {
    const item = await liveItem(room.id, itemId);
    if (member.role !== 'owner' && item.addedBy !== user.id) {
      throw new ForbiddenError('Чужий трек можна прибрати лише через запит власнику кімнати');
    }
    if (item.status === 'playing') {
      await advanceFrom(room, item.id, 'removed');
    } else {
      await repos.queue.setStatus(item.id, 'removed');
      await repos.requests.obsoletePendingFor(item.id);
    }
  });
  events.roomChanged(room.code, 'track-removed');
}

function longestPremiumRun(order: QueueEntry[]): number {
  let run = 0;
  let best = 0;
  for (const e of order) {
    run = e.isPremium ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * K1: a premium user moves their own track one step up or down.
 * Up never passes another user's premium track (they were first), a track locked by a premium owner,
 * or creates more than two premium tracks in a row.
 */
export async function moveItem(code: string, itemId: string, direction: 'up' | 'down') {
  const { room, user } = await requireMember(code);
  const { repos, events } = deps();
  if (user.plan !== 'premium') throw new ForbiddenError('Переставляти треки в черзі можуть лише преміум-користувачі');

  await repos.transaction(async () => {
    await repos.queue.lockRoom(room.id);
    const order = await repos.queue.upcoming(room.id);
    const idx = order.findIndex((e) => e.id === itemId);
    if (idx === -1) throw new NotFoundError('Цього треку немає серед наступних');
    const item = order[idx];
    if (item.addedBy !== user.id) throw new ForbiddenError('Переставляти можна лише власні треки');

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const target = order[targetIdx];
    if (!target) throw new ConflictError('MOVE_NOT_ALLOWED', direction === 'up' ? 'Трек уже перший' : 'Трек уже останній');
    if (direction === 'up') {
      if (target.locked) throw new ConflictError('MOVE_NOT_ALLOWED', 'Власник кімнати поставив цей трек наступним');
      if (target.isPremium && target.addedBy !== user.id) {
        throw new ConflictError('MOVE_NOT_ALLOWED', 'Не можна обігнати трек іншого преміум-користувача, поставлений раніше');
      }
    }
    const reordered = [...order];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    if (longestPremiumRun(reordered) > Math.max(MAX_PREMIUM_RUN, longestPremiumRun(order))) {
      throw new ConflictError('MOVE_NOT_ALLOWED', `Не більше ${MAX_PREMIUM_RUN} преміум-треків поспіль`);
    }
    await repos.queue.setRank(item.id, target.rank);
    await repos.queue.setRank(target.id, item.rank);
  });
  events.roomChanged(room.code, 'track-moved');
}

/** K2: the owner puts a track next; it is protected from premium moves only if the owner is premium too */
export async function playNext(code: string, itemId: string) {
  const { room, user } = await requireOwner(code);
  const { repos, events } = deps();
  await repos.transaction(async () => {
    await repos.queue.lockRoom(room.id);
    const item = await liveItem(room.id, itemId);
    if (item.status !== 'queued') throw new ConflictError('ALREADY_PLAYING', 'Цей трек уже грає');
    await repos.queue.setRank(item.id, (await repos.queue.minRank(room.id)) - 1, user.plan === 'premium');
  });
  events.roomChanged(room.code, 'play-next');
}

export async function upcoming(code: string) {
  const { room } = await requireMember(code);
  return { queue: (await deps().repos.queue.upcoming(room.id)).map(queueItemDto) };
}
