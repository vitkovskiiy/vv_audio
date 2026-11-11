/** Domain entities. Shared by services and every repository implementation (in-memory, PostgreSQL). */

export type Source = 'file' | 'youtube' | 'soundcloud' | 'spotify';
export type Plan = 'free' | 'premium';
export type MemberRole = 'owner' | 'member';
export type QueueStatus = 'queued' | 'playing' | 'played' | 'removed';
export type RequestType = 'remove' | 'skip';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'obsolete';
export type MessageKind = 'user' | 'system';

export interface User {
  id: string;
  username: string;
  plan: Plan;
  isAdmin: boolean;
}

export interface UserWithPassword extends User {
  passHash: string;
}

export interface Room {
  id: string;
  code: string;
  createdAt: Date;
}

export interface Member {
  roomId: string;
  userId: string;
  role: MemberRole;
  lastVisit: Date;
}

export interface Playback {
  roomId: string;
  currentItemId: string | null;
  isPlaying: boolean;
  positionSec: number;
  updatedAt: Date;
}

export interface Track {
  id: string;
  source: Source;
  ref: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
}

export interface QueueItem {
  id: string;
  roomId: string;
  trackId: string;
  addedBy: string;
  /** author's plan at the moment of adding */
  isPremium: boolean;
  status: QueueStatus;
  /** order among queued items, ascending */
  rank: number;
  /** placed by a premium owner via "play next": premium raises cannot pass it */
  locked: boolean;
  addedAt: Date;
}

export interface RoomRequest {
  id: string;
  roomId: string;
  queueItemId: string;
  type: RequestType;
  requestedBy: string;
  status: RequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface Message {
  id: string;
  roomId: string;
  userId: string | null;
  kind: MessageKind;
  text: string;
  createdAt: Date;
}

export interface IdempotencyRecord {
  userId: string;
  key: string;
  requestHash: string;
  statusCode: number;
  response: unknown;
  createdAt: Date;
}

/** read models assembled by repositories in one go (no per-row lookups) */
export interface QueueEntry extends QueueItem {
  track: Track;
  addedByName: string;
}

export interface MemberEntry extends Member {
  username: string;
  plan: Plan;
}

export interface RoomSummary {
  code: string;
  ownerName: string | null;
  role: MemberRole;
  trackCount: number;
  currentTitle: string | null;
  thumbnail: string | null;
  lastVisit: Date;
}

export interface MessageEntry extends Message {
  username: string | null;
}
