import { setTimeout as sleep } from 'node:timers/promises';
import { log } from '../context';
import type { Source, Track } from '../domain/types';
import { ValidationError } from '../errors';

export interface ParsedLink {
  source: Exclude<Source, 'file'>;
  ref: string;
  /** canonical URL to ask the metadata source about */
  url: string;
}

export interface TrackMeta {
  title: string;
  artist: string | null;
  thumbnail: string | null;
}

/** where titles and covers come from; the live one calls oEmbed, the static one serves fixed data */
export interface MetadataSource {
  fetch(link: ParsedLink, signal: AbortSignal): Promise<TrackMeta>;
}

export const RETRY_DELAYS_MS = [200, 600];
export const METADATA_DEADLINE_MS = 8000;
const ATTEMPT_TIMEOUT_MS = 3000;

const FALLBACK_TITLE: Record<ParsedLink['source'], string> = {
  youtube: 'Трек YouTube',
  soundcloud: 'Трек SoundCloud',
  spotify: 'Трек Spotify',
};

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
  return m ? m[2] : null;
}

export function parseLink(raw: string): ParsedLink {
  const input = raw.trim();
  const spotifyUri = input.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  let url: URL;
  try {
    url = new URL(spotifyUri ? `https://open.spotify.com/track/${spotifyUri[1]}` : input);
  } catch {
    throw new ValidationError('Це не схоже на посилання');
  }
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'open.spotify.com') {
    const m = url.pathname.match(/\/track\/([A-Za-z0-9]{22})/);
    if (!m) throw new ValidationError('Підтримуються лише посилання на трек Spotify (open.spotify.com/track/…)');
    return { source: 'spotify', ref: `spotify:track:${m[1]}`, url: `https://open.spotify.com/track/${m[1]}` };
  }
  if (host === 'soundcloud.com' || host === 'm.soundcloud.com') {
    if (url.pathname.split('/').filter(Boolean).length < 2) throw new ValidationError('Потрібне посилання на трек SoundCloud');
    const href = `https://soundcloud.com${url.pathname}`;
    return { source: 'soundcloud', ref: href, url: href };
  }
  const id = youtubeId(url);
  if (id && /^[\w-]{6,20}$/.test(id)) return { source: 'youtube', ref: id, url: `https://www.youtube.com/watch?v=${id}` };

  throw new ValidationError('Підтримуються посилання Spotify, SoundCloud і YouTube');
}

/**
 * Titles are nice to have, not essential: try a few times, then fall back to a generic title
 * so a flaky provider never blocks adding a track.
 */
export async function resolveTrack(
  link: ParsedLink,
  source: MetadataSource,
): Promise<{ track: Omit<Track, 'id'>; fallback: boolean; attempts: number }> {
  const deadline = Date.now() + METADATA_DEADLINE_MS;
  let attempts = 0;

  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    attempts++;
    try {
      const meta = await source.fetch(link, AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, left)));
      return { track: { source: link.source, ref: link.ref, ...meta }, fallback: false, attempts };
    } catch (err) {
      log().warn({ attempt: attempts, source: link.source, err: String(err) }, 'metadata fetch failed');
      if (i < RETRY_DELAYS_MS.length) await sleep(Math.min(RETRY_DELAYS_MS[i], Math.max(0, deadline - Date.now())));
    }
  }

  log().warn({ attempts, source: link.source }, 'metadata unavailable, using fallback title');
  return {
    track: { source: link.source, ref: link.ref, title: FALLBACK_TITLE[link.source], artist: null, thumbnail: null },
    fallback: true,
    attempts,
  };
}

/** oEmbed endpoints of the providers; no API keys needed */
export const liveMetadata: MetadataSource = {
  async fetch(link, signal) {
    const endpoint =
      link.source === 'spotify'
        ? `https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`
        : link.source === 'soundcloud'
          ? `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(link.url)}`
          : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`;
    const res = await fetch(endpoint, { signal });
    if (!res.ok) throw new Error(`oEmbed HTTP ${res.status}`);
    const d = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    let title = d.title ?? FALLBACK_TITLE[link.source];
    // SoundCloud titles look like "Track by Artist"
    const suffix = d.author_name ? ` by ${d.author_name}` : '';
    if (link.source === 'soundcloud' && suffix && title.endsWith(suffix)) title = title.slice(0, -suffix.length);
    return {
      title,
      artist: d.author_name ?? null,
      thumbnail: d.thumbnail_url ?? (link.source === 'youtube' ? `https://i.ytimg.com/vi/${link.ref}/hqdefault.jpg` : null),
    };
  },
};

/**
 * Prototype data with no network. A ref containing "FAILMETA" simulates a provider that never answers,
 * so the retry-and-fallback path can be exercised through the public API.
 */
export const staticMetadata: MetadataSource = {
  fetch(link) {
    if (link.ref.includes('FAILMETA')) return Promise.reject(new Error('simulated provider outage'));
    const n = link.ref.slice(-4);
    return Promise.resolve({ title: `Static track ${n}`, artist: `Artist ${link.source}`, thumbnail: null });
  },
};
