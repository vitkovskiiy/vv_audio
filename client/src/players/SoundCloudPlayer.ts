import { loadScript, withTimeout, type PlayerAdapter, type PlayableTrack } from './types';

declare global {
  interface Window {
    SC?: any;
  }
}

const EMBED_ERROR = 'SoundCloud не отдал трек: возможно, автор запретил встраивание';

export class SoundCloudPlayer implements PlayerAdapter {
  readonly source = 'soundcloud' as const;
  // the widget reports position a few times per second and seeks slower than <audio>
  readonly driftThreshold = 1;
  private widget: any = null;
  private endedCb = () => {};
  private playing = false;
  private pos = 0;
  private posAt = 0;
  private duration = 0;

  constructor(private container: HTMLElement) {}

  private widgetUrl(url: string) {
    const q = new URLSearchParams({ url, auto_play: 'false', visual: 'false', show_comments: 'false', hide_related: 'true' });
    return `https://w.soundcloud.com/player/?${q}`;
  }

  async load(track: PlayableTrack): Promise<void> {
    await loadScript('https://w.soundcloud.com/player/api.js');
    const SC = window.SC;
    this.playing = false;
    this.pos = 0;
    this.posAt = performance.now();
    this.duration = 0;

    if (!this.widget) {
      const iframe = document.createElement('iframe');
      iframe.allow = 'autoplay';
      iframe.width = '100%';
      iframe.height = '166';
      iframe.style.border = '0';
      iframe.src = this.widgetUrl(track.ref);
      this.container.appendChild(iframe);
      this.widget = SC.Widget(iframe);
      const E = SC.Widget.Events;
      this.widget.bind(E.PLAY, () => (this.playing = true));
      this.widget.bind(E.PAUSE, () => (this.playing = false));
      this.widget.bind(E.FINISH, () => {
        this.playing = false;
        this.endedCb();
      });
      this.widget.bind(E.PLAY_PROGRESS, (e: { currentPosition: number }) => {
        this.pos = e.currentPosition / 1000;
        this.posAt = performance.now();
      });
      await withTimeout(new Promise<void>((r) => this.widget.bind(E.READY, () => r())), 15000, EMBED_ERROR);
    } else {
      await withTimeout(
        new Promise<void>((r) => this.widget.load(track.ref, { auto_play: false, callback: () => r() })),
        15000,
        EMBED_ERROR,
      );
    }

    this.duration = await withTimeout(
      new Promise<number>((r) => this.widget.getDuration((ms: number) => r(ms / 1000))),
      5000,
      EMBED_ERROR,
    );
    // a track that can't be embedded loads as an empty widget with zero duration
    if (!this.duration) throw new Error(EMBED_ERROR);
  }

  play() {
    this.widget?.play();
  }
  pause() {
    this.widget?.pause();
  }
  seek(sec: number) {
    this.widget?.seekTo(sec * 1000);
    this.pos = sec;
    this.posAt = performance.now();
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
}
