import type { SearchGroup, SearchResult, Source } from '../shared/types';

const LIMIT = 8;

interface Token {
  value: string;
  expiresAt: number;
}

/** client-credentials token cached until shortly before expiry */
function tokenCache(fetchToken: () => Promise<{ access_token: string; expires_in: number }>) {
  let token: Token | null = null;
  return async (): Promise<string> => {
    if (token && Date.now() < token.expiresAt) return token.value;
    const t = await fetchToken();
    token = { value: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
    return token.value;
  };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function basic(id: string, secret: string) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

type Provider = (q: string) => Promise<SearchResult[]>;

/** only the fields we read from each provider's search response */
interface YoutubeSearch {
  items: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails?: { default?: { url: string } } } }[];
}
interface SoundcloudTrack {
  permalink_url: string;
  title: string;
  user?: { username: string; avatar_url?: string };
  artwork_url?: string | null;
  duration?: number;
}
interface SpotifyTrack {
  external_urls: { spotify: string };
  name: string;
  artists?: { name: string }[];
  album?: { images?: { url: string }[] };
  duration_ms: number;
}

function youtubeProvider(key: string): Provider {
  return async (q) => {
    const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(LIMIT), q, key });
    const data = await getJson<YoutubeSearch>(`https://www.googleapis.com/youtube/v3/search?${params}`);
    return data.items.map((v) => ({
      source: 'youtube',
      url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
      title: decodeEntities(v.snippet.title),
      artist: decodeEntities(v.snippet.channelTitle),
      thumbnail: v.snippet.thumbnails?.default?.url,
    }));
  };
}

function soundcloudProvider(id: string, secret: string): Provider {
  const token = tokenCache(() =>
    getJson('https://secure.soundcloud.com/oauth/token', {
      method: 'POST',
      headers: { Authorization: basic(id, secret), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }),
  );
  return async (q) => {
    const params = new URLSearchParams({ q, limit: String(LIMIT), access: 'playable', linked_partitioning: 'true' });
    const data = await getJson<{ collection: SoundcloudTrack[] } | SoundcloudTrack[]>(`https://api.soundcloud.com/tracks?${params}`, {
      headers: { Authorization: `OAuth ${await token()}` },
    });
    const items = Array.isArray(data) ? data : data.collection;
    return items.map((t) => ({
      source: 'soundcloud',
      url: t.permalink_url,
      title: t.title,
      artist: t.user?.username,
      thumbnail: t.artwork_url ?? t.user?.avatar_url ?? undefined,
      durationSec: t.duration ? t.duration / 1000 : undefined,
    }));
  };
}

function spotifyProvider(id: string, secret: string): Provider {
  const token = tokenCache(() =>
    getJson('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: basic(id, secret), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }),
  );
  return async (q) => {
    const params = new URLSearchParams({ q, type: 'track', limit: String(LIMIT) });
    const data = await getJson<{ tracks: { items: SpotifyTrack[] } }>(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    return data.tracks.items.map((t) => ({
      source: 'spotify',
      url: t.external_urls.spotify,
      title: t.name,
      artist: t.artists?.map((a) => a.name).join(', '),
      thumbnail: t.album?.images?.at(-1)?.url,
      durationSec: t.duration_ms / 1000,
    }));
  };
}

function configuredProviders(): Partial<Record<Source, Provider>> {
  const e = process.env;
  const p: Partial<Record<Source, Provider>> = {};
  if (e.SOUNDCLOUD_CLIENT_ID && e.SOUNDCLOUD_CLIENT_SECRET)
    p.soundcloud = soundcloudProvider(e.SOUNDCLOUD_CLIENT_ID, e.SOUNDCLOUD_CLIENT_SECRET);
  if (e.SPOTIFY_CLIENT_ID && e.SPOTIFY_CLIENT_SECRET) p.spotify = spotifyProvider(e.SPOTIFY_CLIENT_ID, e.SPOTIFY_CLIENT_SECRET);
  if (e.YOUTUBE_API_KEY) p.youtube = youtubeProvider(e.YOUTUBE_API_KEY);
  return p;
}

let providers: Partial<Record<Source, Provider>> | null = null;

export function searchSources(): Source[] {
  providers ??= configuredProviders();
  return Object.keys(providers) as Source[];
}

export async function search(q: string): Promise<SearchGroup[]> {
  providers ??= configuredProviders();
  const entries = Object.entries(providers) as [Source, Provider][];
  const settled = await Promise.allSettled(entries.map(([, run]) => run(q)));
  return entries.map(([source], i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') return { source, results: r.value };
    console.warn(`search ${source} failed:`, r.reason);
    const authFailed = /HTTP (400|401|403)$/.test(String(r.reason));
    return { source, results: [], error: authFailed ? 'Ключ не подошёл, проверьте .env' : 'Поиск временно не работает' };
  });
}
