import type { Playback, Source } from '../../shared/types';
import { FilePlayer } from './players/FilePlayer';
import { SoundCloudPlayer } from './players/SoundCloudPlayer';
import { SpotifyPlayer } from './players/SpotifyPlayer';
import type { PlayableTrack, PlayerAdapter } from './players/types';
import { YouTubePlayer } from './players/YouTubePlayer';
import { serverNow } from './socket';

const CHECK_INTERVAL_MS = 2000;

export interface SyncCallbacks {
  onEnded(trackId: string): void;
  onError(track: PlayableTrack, message: string): void;
  onHint(hint: string | null): void;
  onActiveSource(source: Source | null): void;
}

/** Keeps the local player in line with the server's room state. */
export class SyncEngine {
  private adapters: Record<Source, PlayerAdapter>;
  private active: PlayerAdapter | null = null;
  private loadedTrackId: string | null = null;
  private state: Playback | null = null;
  private running = false;
  private dirty = false;
  private timer: number | undefined;

  constructor(
    containers: Record<Source, HTMLElement>,
    private cb: SyncCallbacks,
  ) {
    this.adapters = {
      file: new FilePlayer(containers.file),
      youtube: new YouTubePlayer(containers.youtube),
      soundcloud: new SoundCloudPlayer(containers.soundcloud),
      spotify: new SpotifyPlayer(containers.spotify),
    };
    for (const a of Object.values(this.adapters)) {
      a.onEnded(() => {
        if (this.active === a && this.loadedTrackId) cb.onEnded(this.loadedTrackId);
      });
      a.onHint?.((h) => this.active === a && cb.onHint(h));
    }
  }

  /** Call from a user gesture: browsers only allow audio after one. */
  start() {
    this.timer = window.setInterval(() => this.reconcile(), CHECK_INTERVAL_MS);
    this.reconcile();
  }

  stop() {
    window.clearInterval(this.timer);
    for (const a of Object.values(this.adapters)) a.pause();
  }

  setState(state: Playback) {
    this.state = state;
    if (this.timer !== undefined) this.reconcile();
  }

  expectedPosition(): number {
    const s = this.state;
    if (!s) return 0;
    return s.isPlaying ? s.positionSec + (serverNow() - new Date(s.updatedAt).getTime()) / 1000 : s.positionSec;
  }

  currentTime(): number {
    return this.active?.getCurrentTime() ?? 0;
  }

  duration(): number {
    return this.active?.getDuration() ?? 0;
  }

  private async reconcile() {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.dirty = false;
        await this.step();
      } while (this.dirty);
    } finally {
      this.running = false;
    }
  }

  private async step() {
    const s = this.state;
    // the queue item id identifies "this play of this track"
    const track: PlayableTrack | undefined = s?.current ? { ...s.current.track, id: s.current.id } : undefined;

    if (!s || !track) {
      this.active?.pause();
      this.loadedTrackId = null;
      this.cb.onActiveSource(null);
      return;
    }

    if (track.id !== this.loadedTrackId) {
      this.active?.pause();
      this.cb.onHint(null);
      this.active = this.adapters[track.source];
      this.cb.onActiveSource(track.source);
      this.loadedTrackId = track.id;
      try {
        await this.active.load(track);
      } catch (e) {
        this.cb.onError(track, e instanceof Error ? e.message : 'Не удалось загрузить трек');
        // skip it for everyone; the server ignores duplicate reports
        this.cb.onEnded(track.id);
        return;
      }
      // state may have moved on while loading
      if (this.state?.current?.id !== track.id) return;
    }

    const a = this.active!;
    const expected = this.expectedPosition();
    const duration = a.getDuration();
    if (s.isPlaying && duration > 0 && expected >= duration) return; // let the player report "ended"

    if (Math.abs(a.getCurrentTime() - expected) > a.driftThreshold) a.seek(expected);
    if (s.isPlaying && !a.isPlaying()) a.play();
    if (!s.isPlaying && a.isPlaying()) a.pause();
  }
}
