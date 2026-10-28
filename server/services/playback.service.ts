import { deps } from '../container';
import type { Playback, QueueStatus, Room } from '../domain/types';
import { ConflictError } from '../errors';
import { requireMember, requireOwner } from './access';
import { roomState } from './rooms.service';

export function currentPosition(p: Playback): number {
  return p.isPlaying ? p.positionSec + (Date.now() - p.updatedAt.getTime()) / 1000 : p.positionSec;
}

/**
 * Moves the room to the next track, but only if `expected` is still the current one.
 * Several clients report the same "track ended" at once; the first one advances,
 * the rest find the current track changed and do nothing (K10).
 * Must run inside a transaction.
 */
export async function advanceFrom(room: Room, expected: string | null, finishedAs: QueueStatus = 'played'): Promise<boolean> {
  const { repos } = deps();
  const [next] = await repos.queue.upcoming(room.id);
  const moved = await repos.playback.advanceIfCurrent(room.id, expected, next?.id ?? null);
  if (!moved) return false;
  if (expected) {
    await repos.queue.setStatus(expected, finishedAs);
    await repos.requests.obsoletePendingFor(expected);
  }
  if (next) await repos.queue.setStatus(next.id, 'playing');
  else await repos.playback.update(room.id, { isPlaying: false, positionSec: 0 });
  return true;
}

export async function control(code: string, action: 'play' | 'pause' | 'seek', positionSec?: number) {
  const { room } = await requireOwner(code);
  const { repos, events } = deps();
  await repos.transaction(async () => {
    const p = await repos.playback.get(room.id);
    if (!p.currentItemId) throw new ConflictError('NOTHING_TO_PLAY', 'Черга порожня');
    const pos = positionSec ?? currentPosition(p);
    if (action === 'play') await repos.playback.update(room.id, { isPlaying: true, positionSec: pos });
    else if (action === 'pause') await repos.playback.update(room.id, { isPlaying: false, positionSec: pos });
    else await repos.playback.update(room.id, { positionSec: Math.max(0, positionSec ?? 0) });
  });
  events.roomChanged(room.code, `playback-${action}`);
  return roomState(room.code);
}

/** owner's "next"; a late duplicate just gets the current state back */
export async function next(code: string, expectedItemId: string | null) {
  const { room } = await requireOwner(code);
  const { repos, events } = deps();
  const moved = await repos.transaction(() => advanceFrom(room, expectedItemId));
  if (moved) events.roomChanged(room.code, 'next');
  return roomState(room.code);
}

/** any member's player reports the end of the track */
export async function ended(code: string, itemId: string) {
  const { room } = await requireMember(code);
  const { repos, events } = deps();
  const moved = await repos.transaction(() => advanceFrom(room, itemId));
  if (moved) events.roomChanged(room.code, 'track-ended');
  return roomState(room.code);
}
