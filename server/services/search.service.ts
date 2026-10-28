import { deps } from '../container';
import { log } from '../context';
import type { Source } from '../domain/types';
import { ValidationError } from '../errors';
import { requireUser } from './access';

export interface SearchResult {
  source: Source;
  url: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  durationSec: number | null;
}

export interface SearchProvider {
  source: Source;
  search(q: string, signal: AbortSignal): Promise<SearchResult[]>;
}

const LIMIT = 8;
const TIMEOUT_MS = 8000;

/** one failing provider must not break the others: each group carries its own error */
export async function search(q: string) {
  requireUser();
  const query = q.trim();
  if (query.length < 2 || query.length > 200) throw new ValidationError('Запит має бути від 2 до 200 символів');
  const providers = deps().searchProviders;
  const settled = await Promise.allSettled(providers.map((p) => p.search(query, AbortSignal.timeout(TIMEOUT_MS))));
  return {
    groups: providers.map((p, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') return { source: p.source, results: r.value.slice(0, LIMIT) };
      log().warn({ provider: p.source, err: String(r.reason) }, 'search provider failed');
      return { source: p.source, results: [], error: 'Пошук у цьому джерелі тимчасово не працює' };
    }),
  };
}

export function searchSources() {
  requireUser();
  return { sources: deps().searchProviders.map((p) => p.source) };
}

async function getJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function youtubeProvider(key: string): SearchProvider {
  return {
    source: 'youtube',
    async search(q, signal) {
      const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(LIMIT), q, key });
      const d = await getJson<{ items: any[] }>(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal });
      return d.items.map((v) => ({
        source: 'youtube' as const,
        url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
        title: decode(v.snippet.title),
        artist: decode(v.snippet.channelTitle),
        thumbnail: v.snippet.thumbnails?.default?.url ?? null,
        durationSec: null,
      }));
    },
  };
}

function clientCredentials(tokenUrl: string, id: string, secret: string) {
  let token: { value: string; expiresAt: number } | null = null;
  return async (signal: AbortSignal) => {
    if (token && Date.now() < token.expiresAt) return token.value;
    const t = await getJson<{ access_token: string; expires_in: number }>(tokenUrl, {
      method: 'POST',
      signal,
      headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    token = { value: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
    return token.value;
  };
}

function soundcloudProvider(id: string, secret: string): SearchProvider {
  const token = clientCredentials('https://secure.soundcloud.com/oauth/token', id, secret);
  return {
    source: 'soundcloud',
    async search(q, signal) {
      const params = new URLSearchParams({ q, limit: String(LIMIT), access: 'playable', linked_partitioning: 'true' });
      const d = await getJson<{ collection: any[] } | any[]>(`https://api.soundcloud.com/tracks?${params}`, {
        signal,
        headers: { Authorization: `OAuth ${await token(signal)}` },
      });
      return (Array.isArray(d) ? d : d.collection).map((t) => ({
        source: 'soundcloud' as const,
        url: t.permalink_url,
        title: t.title,
        artist: t.user?.username ?? null,
        thumbnail: t.artwork_url ?? null,
        durationSec: t.duration ? t.duration / 1000 : null,
      }));
    },
  };
}

function spotifyProvider(id: string, secret: string): SearchProvider {
  const token = clientCredentials('https://accounts.spotify.com/api/token', id, secret);
  return {
    source: 'spotify',
    async search(q, signal) {
      const params = new URLSearchParams({ q, type: 'track', limit: String(LIMIT) });
      const d = await getJson<{ tracks: { items: any[] } }>(`https://api.spotify.com/v1/search?${params}`, {
        signal,
        headers: { Authorization: `Bearer ${await token(signal)}` },
      });
      return d.tracks.items.map((t) => ({
        source: 'spotify' as const,
        url: t.external_urls.spotify,
        title: t.name,
        artist: t.artists?.map((a: { name: string }) => a.name).join(', ') ?? null,
        thumbnail: t.album?.images?.at(-1)?.url ?? null,
        durationSec: t.duration_ms / 1000,
      }));
    },
  };
}

/** providers enabled by the keys present in the environment */
export function liveSearchProviders(env = process.env): SearchProvider[] {
  const p: SearchProvider[] = [];
  if (env.YOUTUBE_API_KEY) p.push(youtubeProvider(env.YOUTUBE_API_KEY));
  if (env.SOUNDCLOUD_CLIENT_ID && env.SOUNDCLOUD_CLIENT_SECRET) p.push(soundcloudProvider(env.SOUNDCLOUD_CLIENT_ID, env.SOUNDCLOUD_CLIENT_SECRET));
  if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) p.push(spotifyProvider(env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET));
  return p;
}

/** prototype providers with fixed results; SoundCloud fails for queries containing "fail" to show isolation */
export function staticSearchProviders(): SearchProvider[] {
  const fake = (source: Source, n: number, q: string): SearchResult => ({
    source,
    url: source === 'youtube' ? `https://www.youtube.com/watch?v=static${n}abcd` : `https://soundcloud.com/static/track-${n}`,
    title: `${q} #${n}`,
    artist: `Artist ${n}`,
    thumbnail: null,
    durationSec: 180 + n,
  });
  return [
    { source: 'youtube', search: async (q) => [1, 2, 3].map((n) => fake('youtube', n, q)) },
    {
      source: 'soundcloud',
      search: async (q) => {
        if (q.includes('fail')) throw new Error('simulated provider outage');
        return [1, 2].map((n) => fake('soundcloud', n, q));
      },
    },
  ];
}
