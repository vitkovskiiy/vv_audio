import type { Source } from '../../../shared/types';

/** what a player needs to load something: id is the queue item, not the catalogue track */
export interface PlayableTrack {
  id: string;
  source: Source;
  ref: string;
  title: string;
}

/** Common contract for every source; the sync engine only talks to this. */
export interface PlayerAdapter {
  readonly source: Source;
  /** seconds of tolerated drift before a corrective seek */
  readonly driftThreshold: number;
  load(track: PlayableTrack): Promise<void>;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  onEnded(cb: () => void): void;
  /** optional user-facing hint, e.g. Spotify playing only a preview */
  onHint?(cb: (hint: string | null) => void): void;
}

const loaded = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loaded.delete(src);
        reject(new Error(`Не удалось загрузить ${src}`));
      };
      document.head.appendChild(s);
    });
    loaded.set(src, p);
  }
  return p;
}

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}
