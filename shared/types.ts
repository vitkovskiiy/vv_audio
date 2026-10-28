/** Shapes of the HTTP API as the client sees them (see server/services/dto.ts). */

export type Source = 'file' | 'youtube' | 'soundcloud' | 'spotify';
export type Plan = 'free' | 'premium';
export type Role = 'owner' | 'member';

export const SOURCE_LABEL: Record<Source, string> = {
  file: 'Файл',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
};

export interface User {
  id: string;
  username: string;
  plan: Plan;
  isAdmin: boolean;
}

export interface ApiTrack {
  id: string;
  source: Source;
  ref: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
}

export interface QueueItem {
  id: string;
  track: ApiTrack;
  addedBy: string;
  isPremium: boolean;
  locked: boolean;
  status: 'queued' | 'playing' | 'played' | 'removed';
}

export interface Playback {
  current: QueueItem | null;
  isPlaying: boolean;
  positionSec: number;
  updatedAt: string;
}

export interface Member {
  username: string;
  role: Role;
  plan: Plan;
}

export interface RoomRequest {
  id: string;
  type: 'remove' | 'skip';
  itemId: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected' | 'obsolete';
  createdAt: string;
  decidedAt: string | null;
}

export interface ChatMessage {
  id: string;
  kind: 'user' | 'system';
  username: string | null;
  text: string;
  createdAt: string;
}

export interface RoomState {
  code: string;
  me: { username: string; role: Role; plan: Plan };
  serverTime: string;
  playback: Playback;
  queue: QueueItem[];
  members: Member[];
  requests: RoomRequest[];
  messages: ChatMessage[];
}

export interface RoomSummary {
  code: string;
  ownerName: string | null;
  role: Role;
  trackCount: number;
  currentTitle: string | null;
  thumbnail: string | null;
  lastVisit: string;
}

export interface SearchResult {
  source: Source;
  url: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  durationSec: number | null;
}

export interface SearchGroup {
  source: Source;
  results: SearchResult[];
  error?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; bpId: string };
}

/** public link for a track, so it goes back through the same "add by link" path */
export function trackUrl(t: Pick<ApiTrack, 'source' | 'ref'>): string | null {
  switch (t.source) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${t.ref}`;
    case 'spotify':
      return `https://open.spotify.com/track/${t.ref.replace('spotify:track:', '')}`;
    case 'soundcloud':
      return t.ref;
    case 'file':
      return null;
  }
}
