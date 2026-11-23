import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * spec.md (Завдання 3), E2E: the first user creates a room, adds tracks and presses play;
 * the second one joins by the room code and sees the same room, queue, current track and playback state.
 */

const run = Date.now().toString(36);

/**
 * Stand-in for the YouTube IFrame API: a player that loads instantly and never ends.
 * Without it the real SDK would have to come from the internet; when it cannot load, the client
 * (correctly) skips the track for everyone, and the test would depend on YouTube being reachable.
 */
const FAKE_YOUTUBE_API = `
  window.YT = {
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
    Player: class {
      constructor(el, opts) { this.opts = opts; this.t = 0; setTimeout(() => opts.events.onReady()); }
      playVideo() { this.opts.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.opts.events.onStateChange({ data: 2 }); }
      seekTo(sec) { this.t = sec; }
      cueVideoById() {}
      getCurrentTime() { return this.t; }
      getDuration() { return 300; }
    },
  };
  window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
`;

/** a separate browser context per person: own cookies, own session, like two devices */
async function person(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  // only our own server and the fake player SDK: nothing from the internet
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.youtube.com' && url.pathname === '/iframe_api') {
      return route.fulfill({ contentType: 'text/javascript', body: FAKE_YOUTUBE_API });
    }
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Реєстрація' }).click();
  await page.getByLabel('Логін').fill(`${name}_${run}`);
  await page.getByLabel('Пароль').fill('password123');
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  await expect(page.getByRole('button', { name: 'Створити кімнату' })).toBeVisible();
  return page;
}

async function turnOnSound(page: Page) {
  await page.getByRole('button', { name: 'Увімкнути звук' }).click();
}

async function addLink(page: Page, url: string) {
  const search = page.getByLabel('Пошук або посилання');
  await search.fill(url);
  await search.press('Enter');
}

const nowPlaying = (page: Page) => page.locator('.stage-meta .track-name');
const queueTitles = (page: Page) => page.locator('section.queue ol.tracks .track-title');
const playButton = (page: Page) => page.locator('.controls .play-btn');
const roomCode = (page: Page) => page.locator('.room-chip b');

test('a friend who joins by code sees the same room, queue, current track and playback state', async ({ browser }) => {
  // the first user: room, two tracks, play
  const host = await person(browser, 'host');
  await host.getByRole('button', { name: 'Створити кімнату' }).click();
  await expect(host).toHaveURL(/\?room=[A-Z0-9]+/);
  const code = new URL(host.url()).searchParams.get('room')!;
  await turnOnSound(host);

  await addLink(host, 'https://youtu.be/aaaaaaa0001');
  await expect(nowPlaying(host)).toHaveText('Static track 0001');
  await addLink(host, 'https://youtu.be/aaaaaaa0002');
  await expect(queueTitles(host)).toHaveText(['Static track 0002']);
  await playButton(host).click();
  await expect(playButton(host)).toHaveAttribute('aria-label', 'Пауза');

  // the second user joins by the code
  const friend = await person(browser, 'friend');
  await friend.getByLabel('Код кімнати').fill(code);
  await friend.getByRole('button', { name: 'Увійти', exact: true }).click();
  await turnOnSound(friend);

  await expect(roomCode(friend)).toHaveText(code);
  await expect(nowPlaying(friend)).toHaveText(await nowPlaying(host).innerText());
  await expect(queueTitles(friend)).toHaveText(await queueTitles(host).allInnerTexts());
  await expect(playButton(friend)).toHaveAttribute('aria-label', 'Пауза');

  // and it stays the same: the host pauses, the friend's room follows without a reload
  await playButton(host).click();
  await expect(playButton(host)).toHaveAttribute('aria-label', 'Грати');
  await expect(playButton(friend)).toHaveAttribute('aria-label', 'Грати');
});
