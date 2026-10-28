import type { Track } from '../../../shared/types';
import { loadScript, withTimeout, type PlayerAdapter } from './types';

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: any) => void;
  }
}

interface PlaybackUpdate {
  isPaused: boolean;
  isBuffering: boolean;
  duration: number; // ms
  position: number; // ms
}

let apiReady: Promise<any> | null = null;
function loadApi(): Promise<any> {
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      window.onSpotifyIframeApiReady = (api) => resolve(api);
      loadScript('https://open.spotify.com/embed/iframe-api/v1').catch((err) => {
        apiReady = null; // allow a retry on the next load
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
  return apiReady;
}

const PREVIEW_HINT =
  'Spotify играет только 30-секундное превью. Войдите в Spotify (open.spotify.com) в этом же браузере и обновите страницу.';

/**
 * Uses the public Spotify Embed iFrame API, which needs no Premium or API keys.
 * The embed plays full tracks only for viewers logged in to Spotify in this browser.
 */
export class SpotifyPlayer implements PlayerAdapter {
  readonly source = 'spotify' as const;
  readonly driftThreshold = 1;
  private controller: any = null;
  private readyResolve: (() => void) | null = null;
  private endedCb = () => {};
  private hintCb: (hint: string | null) => void = () => {};
  private playing = false;
  private started = false;
  private nearEnd = false;
  private endedFired = false;
  private pos = 0;
  private posAt = 0;
  private duration = 0;

  constructor(private container: HTMLElement) {}

  private onUpdate = (e: { data: PlaybackUpdate }) => {
    const d = e.data;
    const prevPos = this.pos;
    this.playing = !d.isPaused;
    this.pos = d.position / 1000;
    this.posAt = performance.now();
    if (d.duration) {
      this.duration = d.duration / 1000;
      // previews are cut to ~30 s; full tracks that short are rare enough to ignore
      this.hintCb(d.duration <= 31000 ? PREVIEW_HINT : null);
    }
    // the embed has no "ended" event: detect reaching the end, then a pause or a jump back to 0
    if (this.duration && this.pos >= this.duration - 1) this.nearEnd = true;
    const finished = this.nearEnd && (d.isPaused || this.pos < prevPos - 5);
    if (finished && !this.endedFired) {
      this.endedFired = true;
      this.playing = false;
      this.endedCb();
    }
  };

  async load(track: Track): Promise<void> {
    const api = await withTimeout(loadApi(), 15000, 'Spotify-плеер не загрузился');
    this.playing = false;
    this.started = false;
    this.nearEnd = false;
    this.endedFired = false;
    this.pos = 0;
    this.posAt = performance.now();
    this.duration = 0;
    this.hintCb(null);

    if (!this.controller) {
      const mount = document.createElement('div');
      this.container.appendChild(mount);
      await withTimeout(
        new Promise<void>((resolve) => {
          this.readyResolve = resolve;
          api.createController(mount, { uri: track.ref, width: '100%', height: 152 }, (ctrl: any) => {
            this.controller = ctrl;
            ctrl.addListener('playback_update', this.onUpdate);
            ctrl.addListener('ready', () => {
              this.readyResolve?.();
              this.readyResolve = null;
            });
          });
        }),
        15000,
        'Spotify-плеер не запустился',
      );
      return;
    }
    // "ready" is not guaranteed to fire again after loadUri, so wait for it only briefly
    await withTimeout(
      new Promise<void>((resolve) => {
        this.readyResolve = resolve;
        this.controller.loadUri(track.ref);
      }),
      3000,
      '',
    ).catch(() => {});
  }

  play() {
    if (!this.controller) return;
    if (this.started) this.controller.resume();
    else this.controller.play();
    this.started = true;
  }
  pause() {
    this.controller?.pause();
  }
  seek(sec: number) {
    this.controller?.seek(sec);
    this.pos = sec;
    this.posAt = performance.now();
    if (this.duration && sec < this.duration - 1) this.nearEnd = false;
  }
  getCurrentTime() {
    return this.playing ? this.pos + (performance.now() - this.posAt) / 1000 : this.pos;
  }
  getDuration() {
    return this.duration;
  }
  isPlaying() {
    return this.playing;
  }
  onEnded(cb: () => void) {
    this.endedCb = cb;
  }
  onHint(cb: (hint: string | null) => void) {
    this.hintCb = cb;
  }
}
