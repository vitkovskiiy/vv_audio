import type { MemberEntry, MessageEntry, Playback, QueueEntry, RoomRequest, RoomSummary, Track, User } from '../domain/types';

/** API shapes: plain JSON (dates as ISO strings) so a stored idempotent response replays byte-for-byte */

export const userDto = (u: User) => ({ id: u.id, username: u.username, plan: u.plan, isAdmin: u.isAdmin });

export const trackDto = (t: Track) => ({
  id: t.id,
  source: t.source,
  ref: t.ref,
  title: t.title,
  artist: t.artist,
  thumbnail: t.thumbnail,
});

export const queueItemDto = (e: QueueEntry) => ({
  id: e.id,
  track: trackDto(e.track),
  addedBy: e.addedByName,
  isPremium: e.isPremium,
  locked: e.locked,
  status: e.status,
});

export const playbackDto = (p: Playback, current: QueueEntry | undefined) => ({
  current: current ? queueItemDto(current) : null,
  isPlaying: p.isPlaying,
  positionSec: p.positionSec,
  updatedAt: p.updatedAt.toISOString(),
});

export const memberDto = (m: MemberEntry) => ({ username: m.username, role: m.role, plan: m.plan });

export const requestDto = (r: RoomRequest, requestedBy: string) => ({
  id: r.id,
  type: r.type,
  itemId: r.queueItemId,
  requestedBy,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

export const messageDto = (m: MessageEntry) => ({
  id: m.id,
  kind: m.kind,
  username: m.username,
  text: m.text,
  createdAt: m.createdAt.toISOString(),
});

export const roomSummaryDto = (r: RoomSummary) => ({ ...r, lastVisit: r.lastVisit.toISOString() });
