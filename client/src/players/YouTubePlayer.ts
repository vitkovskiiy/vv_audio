import { loadScript, withTimeout, type PlayerAdapter, type PlayableTrack } from './types';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<any> | null = null;
function loadApi(): Promise<any> {
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      loadScript('https://www.youtube.com/iframe_api').catch((err) => {
        apiReady = null; // allow a retry on the next load
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
  return apiReady;
}

export class YouTubePlayer implements PlayerAdapter {
  readonly source = 'youtube' as const;
  readonly driftThreshold = 0.3;
  private player: any = null;
  private endedCb = () => {};
  private state = -1;

  constructor(private container: HTMLElement) {}

  async load(track: PlayableTrack): Promise<void> {
    const YT = await withTimeout(loadApi(), 15000, 'YouTube не загрузился');
    if (this.player) {
      this.state = -1;
      this.player.cueVideoById(track.ref);
      return;
    }
    const mount = document.createElement('div');
    this.container.appendChild(mount);
    await withTimeout(
      new Promise<void>((resolve) => {
        this.player = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          videoId: track.ref,
          playerVars: { playsinline: 1, rel: 0, disablekb: 1 },
          events: {
            onReady: () => resolve(),
            onStateChange: (e: { data: number }) => {
              this.state = e.data;
              if (e.data === YT.PlayerState.ENDED) this.endedCb();
            },
          },
        });
      }),
      15000,
      'YouTube-плеер не запустился',
    );
  }

  play() {
    this.player?.playVideo();
  }
  pause() {
    this.player?.pauseVideo();
  }
  seek(sec: number) {
    this.player?.seekTo(sec, true);
  }
  getCurrentTime() {
    return this.player?.getCurrentTime?.() ?? 0;
  }
  getDuration() {
    return this.player?.getDuration?.() ?? 0;
  }
  isPlaying() {
    // PLAYING = 1, BUFFERING = 3: both mean "trying to play"
    return this.state === 1 || this.state === 3;
  }
  onEnded(cb: () => void) {
    this.endedCb = cb;
  }
}
