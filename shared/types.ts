export type Source = 'file' | 'youtube' | 'soundcloud' | 'spotify';

export interface Track {
  id: string;
  source: Source;
  /** file: /uploads/x.mp3, youtube: videoId, soundcloud: permalink, spotify: spotify:track:ID */
  ref: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  addedBy: string;
}

export interface RoomState {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  positionSec: number;
  updatedAtServerMs: number;
}

export interface Member {
  id: string;
  name: string;
}

export interface User {
  id: number;
  username: string;
}

/** a saved track; the same fields a queue entry needs */
export interface Favorite {
  source: Source;
  ref: string;
  title: string;
  artist?: string;
  thumbnail?: string;
}

export interface RoomSummary {
  id: string;
  owner?: string;
  trackCount: number;
  currentTitle?: string;
  thumbnail?: string;
  lastVisit: number;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
}

export type ControlAction =
  | { type: 'play'; positionSec?: number }
  | { type: 'pause'; positionSec?: number }
  | { type: 'seek'; positionSec: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'select'; index: number }
  | { type: 'remove'; index: number };

export type Ack<T = undefined> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface ServerToClient {
  state: (state: RoomState) => void;
  members: (members: Member[]) => void;
  chat: (msg: ChatMessage) => void;
  chatHistory: (msgs: ChatMessage[]) => void;
}

export interface ClientToServer {
  join: (roomId: string, ack: Ack) => void;
  timesync: (ack: (serverNow: number) => void) => void;
  chat: (text: string) => void;
  control: (action: ControlAction) => void;
  addUrl: (url: string, ack: Ack) => void;
  addFile: (data: { ref: string; title: string }, ack: Ack) => void;
  ended: (trackId: string) => void;
}

export const SOURCE_LABEL: Record<Source, string> = {
  file: 'Файл',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
};

export interface SearchResult {
  source: Source;
  /** public track URL; added to the queue through the same path as a pasted link */
  url: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  durationSec?: number;
}

export interface SearchGroup {
  source: Source;
  results: SearchResult[];
  error?: string;
}

/** public link for a track, so it can go back through the same "add by link" path */
export function trackUrl(t: Pick<Track, 'source' | 'ref'>): string | null {
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
