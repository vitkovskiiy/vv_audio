import type { Repositories } from './ports';
import { hashPassword } from '../services/auth.service';

export const SEED_PASSWORD = 'password123';

/**
 * Static prototype data: a big room (8 people, mixed free/premium tracks), a small one, an admin.
 * Development only: every account shares SEED_PASSWORD.
 */
export async function seed(repos: Repositories) {
  const passHash = await hashPassword(SEED_PASSWORD);
  const mk = (username: string, plan: 'free' | 'premium' = 'free', isAdmin = false) =>
    repos.users.create({ username, passHash, plan, isAdmin });

  const admin = await mk('admin', 'premium', true);
  const vika = await mk('vika');
  const borya = await mk('borya', 'premium');
  const dana = await mk('dana', 'premium');
  const others = await Promise.all(['ivan', 'oleh', 'maria', 'taras', 'sofia'].map((n) => mk(n)));

  const party = await repos.rooms.create('PARTY5');
  await repos.playback.create(party.id);
  await repos.members.add({ roomId: party.id, userId: vika.id, role: 'owner' });
  for (const u of [borya, dana, ...others]) await repos.members.add({ roomId: party.id, userId: u.id, role: 'member' });

  const tracks = [
    { by: vika, source: 'youtube', ref: 'xtxjm7ciwmc', title: 'Группа крови', artist: 'Кино' },
    { by: borya, source: 'soundcloud', ref: 'https://soundcloud.com/forss/flickermood', title: 'Flickermood', artist: 'Forss' },
    { by: others[0], source: 'youtube', ref: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
    { by: dana, source: 'youtube', ref: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi' },
    { by: others[1], source: 'spotify', ref: 'spotify:track:4PTG3Z6ehGkBFwjybzWkR8', title: 'Never Gonna Give You Up', artist: null },
    { by: borya, source: 'youtube', ref: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artist: 'Queen' },
  ] as const;
  for (const t of tracks) {
    const track = await repos.tracks.upsert({ source: t.source, ref: t.ref, title: t.title, artist: t.artist, thumbnail: null });
    await repos.queue.add({
      roomId: party.id,
      trackId: track.id,
      addedBy: t.by.id,
      isPremium: t.by.plan === 'premium',
      status: 'queued',
      locked: false,
    });
  }
  const [first] = await repos.queue.upcoming(party.id);
  await repos.playback.advanceIfCurrent(party.id, null, first.id);
  await repos.queue.setStatus(first.id, 'playing');
  await repos.messages.add({ roomId: party.id, userId: vika.id, kind: 'user', text: 'Всім привіт, кидайте треки!' });
  await repos.messages.add({ roomId: party.id, userId: borya.id, kind: 'user', text: 'Підняв свій Queen 😎' });

  const chill = await repos.rooms.create('CHILL2');
  await repos.playback.create(chill.id);
  await repos.members.add({ roomId: chill.id, userId: borya.id, role: 'owner' });
  await repos.members.add({ roomId: chill.id, userId: dana.id, role: 'member' });

  return { admin, vika, borya, dana, others };
}
