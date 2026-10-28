import type { PlayerAdapter, PlayableTrack } from './types';

/** Plays uploaded audio and video files; a <video> element handles both. */
export class FilePlayer implements PlayerAdapter {
  readonly source = 'file' as const;
  readonly driftThreshold = 0.3;
  private media = document.createElement('video');
  private endedCb = () => {};

  constructor(container: HTMLElement) {
    this.media.preload = 'auto';
    this.media.playsInline = true;
    this.media.addEventListener('ended', () => this.endedCb());
    container.appendChild(this.media);
  }

  load(track: PlayableTrack): Promise<void> {
    return new Promise((resolve, reject) => {
      const m = this.media;
      const cleanup = () => {
        m.removeEventListener('loadedmetadata', done);
        m.removeEventListener('error', fail);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error('Не удалось открыть файл'));
      };
      m.addEventListener('loadedmetadata', done);
      m.addEventListener('error', fail);
      m.src = track.ref;
      m.load();
    });
  }

  play() {
    this.media.play().catch(() => {});
  }
  pause() {
    this.media.pause();
  }
  seek(sec: number) {
    this.media.currentTime = sec;
  }
  getCurrentTime() {
    return this.media.currentTime;
  }
  getDuration() {
    return Number.isFinite(this.media.duration) ? this.media.duration : 0;
  }
  isPlaying() {
    return !this.media.paused;
  }
  onEnded(cb: () => void) {
    this.endedCb = cb;
  }
}
