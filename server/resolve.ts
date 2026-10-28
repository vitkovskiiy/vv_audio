import type { Track } from '../shared/types';

type Resolved = Omit<Track, 'id' | 'addedBy'>;

interface OEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

async function oembed(endpoint: string): Promise<OEmbed | null> {
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as OEmbed;
  } catch {
    return null;
  }
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
  return m ? m[2] : null;
}

export async function resolveUrl(raw: string): Promise<Resolved> {
  const input = raw.trim();

  const spotifyUri = input.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  let url: URL;
  try {
    url = new URL(spotifyUri ? `https://open.spotify.com/track/${spotifyUri[1]}` : input);
  } catch {
    throw new Error('Это не похоже на ссылку');
  }
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'open.spotify.com') {
    const m = url.pathname.match(/\/track\/([A-Za-z0-9]{22})/);
    if (!m) throw new Error('Поддерживаются только ссылки на трек Spotify (open.spotify.com/track/...)');
    const meta = await oembed(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${m[1]}`)}`);
    return {
      source: 'spotify',
      ref: `spotify:track:${m[1]}`,
      title: meta?.title ?? 'Трек Spotify',
      thumbnail: meta?.thumbnail_url,
    };
  }

  if (host === 'soundcloud.com' || host === 'm.soundcloud.com' || host === 'on.soundcloud.com') {
    const meta = await oembed(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url.href)}`);
    if (!meta) throw new Error('SoundCloud не нашёл трек или автор запретил встраивание');
    // SoundCloud titles look like "Track by Artist"
    const suffix = meta.author_name ? ` by ${meta.author_name}` : '';
    const title = meta.title && suffix && meta.title.endsWith(suffix) ? meta.title.slice(0, -suffix.length) : meta.title;
    return {
      source: 'soundcloud',
      ref: url.href.replace('//m.soundcloud.com', '//soundcloud.com'),
      title: title ?? 'Трек SoundCloud',
      artist: meta.author_name,
      thumbnail: meta.thumbnail_url,
    };
  }

  const ytId = youtubeId(url);
  if (ytId) {
    const meta = await oembed(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ytId}`)}`,
    );
    return {
      source: 'youtube',
      ref: ytId,
      title: meta?.title ?? 'Видео YouTube',
      artist: meta?.author_name,
      thumbnail: meta?.thumbnail_url ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  throw new Error('Поддерживаются ссылки Spotify, SoundCloud и YouTube');
}
