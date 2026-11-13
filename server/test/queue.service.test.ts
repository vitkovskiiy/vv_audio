import { beforeEach, describe, expect, it } from 'vitest';
import { deps } from '../container';
import type { User } from '../domain/types';
import { addTrack, MAX_PREMIUM_RUN, moveItem, playNext, removeItem, upcoming } from '../services/queue.service';
import { createRequest } from '../services/requests.service';
import { createWorld, type World } from './world';

/**
 * spec.md (Завдання 3): queue.service — 100% гілок; правила преміуму перевіряються unit-тестами в `npm test`.
 * Each rule is checked on both sides of its boundary, so a flipped comparison or a dropped condition fails a test.
 */

let w: World;
let owner: User;
let alice: User; // premium member
let bob: User; // premium member
let carl: User; // free member

beforeEach(async () => {
  w = createWorld();
  owner = await w.user('free', 'owner');
  alice = await w.user('premium', 'alice');
  bob = await w.user('premium', 'bob');
  carl = await w.user('free', 'carl');
});

const moveNotAllowed = (message: string) => ({ status: 409, code: 'MOVE_NOT_ALLOWED', message });

describe('moveItem — premium run limit (spec: 2 поспіль можна, 3 → 409)', () => {
  it('the limit is two', () => {
    expect(MAX_PREMIUM_RUN).toBe(2);
  });

  it('allows a raise that makes exactly 2 premium tracks in a row', async () => {
    const room = await w.room(owner, alice, bob, carl);
    const p1 = await w.put(room, bob);
    const o = await w.put(room, carl);
    const mine = await w.put(room, alice);

    await w.as(alice, () => moveItem(room.code, mine.id, 'up'));

    expect(await w.order(room)).toEqual([p1.id, mine.id, o.id]);
  });

  it('rejects a raise that makes 3 premium tracks in a row with 409, order unchanged', async () => {
    const room = await w.room(owner, alice, bob, carl);
    const p1 = await w.put(room, bob);
    const p2 = await w.put(room, bob);
    const o = await w.put(room, carl);
    const mine = await w.put(room, alice);

    await expect(w.as(alice, () => moveItem(room.code, mine.id, 'up'))).rejects.toMatchObject(
      moveNotAllowed('Не більше 2 преміум-треків поспіль'),
    );
    expect(await w.order(room)).toEqual([p1.id, p2.id, o.id, mine.id]);
  });

  it('a run that was already longer than 2 does not block a move that does not lengthen it', async () => {
    const room = await w.room(owner, alice, bob, carl);
    const p = [await w.put(room, bob), await w.put(room, bob), await w.put(room, bob)];
    const mineFree = await w.put(room, alice, { premium: false });
    const tail = await w.put(room, carl);

    await w.as(alice, () => moveItem(room.code, mineFree.id, 'down'));

    expect(await w.order(room)).toEqual([...p.map((i) => i.id), tail.id, mineFree.id]);
  });

  it('but does block a move that makes that run even longer', async () => {
    const room = await w.room(owner, alice, bob, carl);
    await w.put(room, bob);
    await w.put(room, bob);
    await w.put(room, bob);
    await w.put(room, carl);
    const mine = await w.put(room, alice);

    await expect(w.as(alice, () => moveItem(room.code, mine.id, 'up'))).rejects.toMatchObject(
      moveNotAllowed('Не більше 2 преміум-треків поспіль'),
    );
  });
});

describe('moveItem — overtaking (spec: чужий раніший преміум → 409, свій → можна)', () => {
  it("rejects raising over another user's earlier premium track", async () => {
    const room = await w.room(owner, alice, bob);
    const theirs = await w.put(room, bob);
    const mine = await w.put(room, alice);

    await expect(w.as(alice, () => moveItem(room.code, mine.id, 'up'))).rejects.toMatchObject(
      moveNotAllowed('Не можна обігнати трек іншого преміум-користувача, поставлений раніше'),
    );
    expect(await w.order(room)).toEqual([theirs.id, mine.id]);
  });

  it('allows raising over your own premium track', async () => {
    const room = await w.room(owner, alice);
    const first = await w.put(room, alice);
    const second = await w.put(room, alice);

    await w.as(alice, () => moveItem(room.code, second.id, 'up'));

    expect(await w.order(room)).toEqual([second.id, first.id]);
  });

  it('allows raising over a non-premium track of someone else', async () => {
    const room = await w.room(owner, alice, carl);
    const theirs = await w.put(room, carl);
    const mine = await w.put(room, alice);

    await w.as(alice, () => moveItem(room.code, mine.id, 'up'));

    expect(await w.order(room)).toEqual([mine.id, theirs.id]);
  });

  it('allows raising over a track that was premium-added by someone now free (the flag is what counts)', async () => {
    const room = await w.room(owner, alice, carl);
    const theirs = await w.put(room, carl, { premium: false });
    const mine = await w.put(room, alice);

    await w.as(alice, () => moveItem(room.code, mine.id, 'up'));

    expect(await w.order(room)).toEqual([mine.id, theirs.id]);
  });

  it('rejects raising over a track the premium owner locked with "play next"', async () => {
    const room = await w.room(owner, alice);
    const locked = await w.put(room, owner, { locked: true, premium: false });
    const mine = await w.put(room, alice);

    await expect(w.as(alice, () => moveItem(room.code, mine.id, 'up'))).rejects.toMatchObject(
      moveNotAllowed('Власник кімнати поставив цей трек наступним'),
    );
    expect(await w.order(room)).toEqual([locked.id, mine.id]);
  });

  it("lowering is never blocked by the target's premium or lock", async () => {
    const room = await w.room(owner, alice, bob);
    const mine = await w.put(room, alice);
    const theirs = await w.put(room, bob, { locked: true });

    await w.as(alice, () => moveItem(room.code, mine.id, 'down'));

    expect(await w.order(room)).toEqual([theirs.id, mine.id]);
  });
});

describe('moveItem — who and what can be moved', () => {
  it('free users cannot reorder: 403', async () => {
    const room = await w.room(owner, carl);
    await w.put(room, carl);
    const mine = await w.put(room, carl);

    await expect(w.as(carl, () => moveItem(room.code, mine.id, 'up'))).rejects.toMatchObject({
      status: 403,
      message: 'Переставляти треки в черзі можуть лише преміум-користувачі',
    });
  });

  it('non-members cannot reorder: 403', async () => {
    const room = await w.room(owner, carl);
    const item = await w.put(room, carl);

    await expect(w.as(alice, () => moveItem(room.code, item.id, 'up'))).rejects.toMatchObject({ status: 403 });
  });

  it("a premium user cannot move someone else's track: 403", async () => {
    const room = await w.room(owner, alice, carl);
    await w.put(room, carl);
    const theirs = await w.put(room, carl);

    await expect(w.as(alice, () => moveItem(room.code, theirs.id, 'up'))).rejects.toMatchObject({
      status: 403,
      message: 'Переставляти можна лише власні треки',
    });
  });

  it('a track that is not upcoming (unknown or already playing) is 404', async () => {
    const room = await w.room(owner, alice);
    await w.put(room, alice);

    await expect(w.as(alice, () => moveItem(room.code, '00000000-0000-7000-8000-000000000000', 'up'))).rejects.toMatchObject({
      status: 404,
      message: 'Цього треку немає серед наступних',
    });
  });

  it('the first track cannot go up and the last cannot go down: 409', async () => {
    const room = await w.room(owner, alice);
    const first = await w.put(room, alice);
    const last = await w.put(room, alice);

    await expect(w.as(alice, () => moveItem(room.code, first.id, 'up'))).rejects.toMatchObject(moveNotAllowed('Трек уже перший'));
    await expect(w.as(alice, () => moveItem(room.code, last.id, 'down'))).rejects.toMatchObject(moveNotAllowed('Трек уже останній'));
    expect(await w.order(room)).toEqual([first.id, last.id]);
  });

  it('a successful move notifies the room', async () => {
    const room = await w.room(owner, alice);
    await w.put(room, alice);
    const second = await w.put(room, alice);

    await w.as(alice, () => moveItem(room.code, second.id, 'up'));

    expect(w.events.at(-1)).toEqual({ code: room.code, reason: 'track-moved' });
  });
});

describe('playNext — owner puts a track first', () => {
  it('a free owner moves the track to the front without locking it', async () => {
    const room = await w.room(owner, carl);
    const a = await w.put(room, carl);
    const b = await w.put(room, carl);

    await w.as(owner, () => playNext(room.code, b.id));

    expect(await w.order(room)).toEqual([b.id, a.id]);
    expect((await w.repos.queue.find(b.id))?.locked).toBe(false);
    expect(w.events.at(-1)).toEqual({ code: room.code, reason: 'play-next' });
  });

  it('a premium owner moves it to the front and locks it, so premium raises cannot pass it', async () => {
    const premiumOwner = await w.user('premium', 'powner');
    const room = await w.room(premiumOwner, alice, carl);
    const a = await w.put(room, carl);
    const b = await w.put(room, carl);
    const mine = await w.put(room, alice);

    await w.as(premiumOwner, () => playNext(room.code, b.id));
    await w.as(alice, () => moveItem(room.code, mine.id, 'up')); // passes a (not premium, not locked)

    expect((await w.repos.queue.find(b.id))?.locked).toBe(true);
    expect(await w.order(room)).toEqual([b.id, mine.id, a.id]);
    await expect(w.as(alice, () => moveItem(room.code, mine.id, 'up'))).rejects.toMatchObject(
      moveNotAllowed('Власник кімнати поставив цей трек наступним'),
    );
  });

  it('a member cannot use it: 403', async () => {
    const room = await w.room(owner, carl);
    const a = await w.put(room, carl);

    await expect(w.as(carl, () => playNext(room.code, a.id))).rejects.toMatchObject({
      status: 403,
      message: 'Це може робити лише власник кімнати',
    });
  });

  it('the track that is already playing: 409 ALREADY_PLAYING', async () => {
    const room = await w.room(owner);
    await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaaaaaa', undefined));
    const current = (await w.repos.playback.get(room.id)).currentItemId!;

    await expect(w.as(owner, () => playNext(room.code, current))).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_PLAYING',
      message: 'Цей трек уже грає',
    });
  });

  it('a track that left the queue or belongs to another room: 404', async () => {
    const room = await w.room(owner, carl);
    const other = await w.room(carl);
    const gone = await w.put(room, carl);
    await w.repos.queue.setStatus(gone.id, 'played');
    const foreign = await w.put(other, carl);

    for (const id of [gone.id, foreign.id, '00000000-0000-7000-8000-000000000000']) {
      await expect(w.as(owner, () => playNext(room.code, id))).rejects.toMatchObject({
        status: 404,
        message: 'Цього треку вже немає в черзі',
      });
    }
  });
});

describe('removeItem', () => {
  it('the author removes their own queued track; pending requests on it become obsolete', async () => {
    const room = await w.room(owner, carl, alice);
    const mine = await w.put(room, carl);
    const req = await w.as(alice, () => createRequest(room.code, 'remove', mine.id));

    await w.as(carl, () => removeItem(room.code, mine.id));

    expect((await w.repos.queue.find(mine.id))?.status).toBe('removed');
    expect((await w.repos.requests.find(req.body.id))?.status).toBe('obsolete');
    expect(await w.order(room)).toEqual([]);
    expect(w.events.at(-1)).toEqual({ code: room.code, reason: 'track-removed' });
  });

  it("the owner removes anyone's track", async () => {
    const room = await w.room(owner, carl);
    const theirs = await w.put(room, carl);

    await w.as(owner, () => removeItem(room.code, theirs.id));

    expect((await w.repos.queue.find(theirs.id))?.status).toBe('removed');
  });

  it("a member cannot remove someone else's track directly: 403, the track stays", async () => {
    const room = await w.room(owner, carl, alice);
    const theirs = await w.put(room, alice);

    await expect(w.as(carl, () => removeItem(room.code, theirs.id))).rejects.toMatchObject({
      status: 403,
      message: 'Чужий трек можна прибрати лише через запит власнику кімнати',
    });
    expect((await w.repos.queue.find(theirs.id))?.status).toBe('queued');
  });

  it('removing the playing track advances to the next one', async () => {
    const room = await w.room(owner);
    await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaaaaaa', undefined));
    await w.as(owner, () => addTrack(room.code, 'https://youtu.be/bbbbbbbbbbb', undefined));
    const playing = (await w.repos.playback.get(room.id)).currentItemId!;
    const [next] = await w.order(room);

    await w.as(owner, () => removeItem(room.code, playing));

    expect((await w.repos.queue.find(playing))?.status).toBe('removed');
    expect((await w.repos.playback.get(room.id)).currentItemId).toBe(next);
    expect((await w.repos.queue.find(next))?.status).toBe('playing');
  });

  it('a track that is already gone: 404', async () => {
    const room = await w.room(owner);
    const item = await w.put(room, owner);
    await w.repos.queue.setStatus(item.id, 'removed');

    await expect(w.as(owner, () => removeItem(room.code, item.id))).rejects.toMatchObject({ status: 404 });
  });
});

describe('addTrack', () => {
  it('the first track of an empty room becomes current (paused); the next one is queued', async () => {
    const room = await w.room(owner, alice);

    const first = await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaaaaaa', undefined));
    const second = await w.as(alice, () => addTrack(room.code, 'https://youtu.be/bbbbbbbbbbb', undefined));

    expect(first.status).toBe(201);
    expect(first.replayed).toBe(false);
    expect(first.body.item.isPremium).toBe(false);
    expect(first.body.metadataFallback).toBe(false);
    expect(second.body.item.isPremium).toBe(true);

    const pb = await w.repos.playback.get(room.id);
    expect(pb.currentItemId).toBe(first.body.item.id);
    expect(pb.isPlaying).toBe(false);
    expect(await w.order(room)).toEqual([second.body.item.id]);
    expect((await w.repos.messages.recent(room.id, 10)).map((m) => m.text)).toContain('alice додав(ла) «Static track bbbb»');
    expect(w.events.filter((e) => e.reason === 'track-added')).toHaveLength(2);
  });

  // mutation #137 survived: every other test built the queue with the w.put() helper, which sets
  // locked itself, so nothing checked what addTrack stores. A locked new track blocks every premium raise.
  it('a track added through addTrack is not locked: a premium user can raise over it', async () => {
    const room = await w.room(owner, alice, carl);
    await w.as(carl, () => addTrack(room.code, 'https://youtu.be/ccccccccccc', undefined)); // becomes current
    const theirs = await w.as(carl, () => addTrack(room.code, 'https://youtu.be/ddddddddddd', undefined));
    const mine = await w.as(alice, () => addTrack(room.code, 'https://youtu.be/eeeeeeeeeee', undefined));

    await w.as(alice, () => moveItem(room.code, mine.body.item.id, 'up'));

    expect((await w.repos.queue.find(theirs.body.item.id))?.locked).toBe(false);
    expect(await w.order(room)).toEqual([mine.body.item.id, theirs.body.item.id]);
  });

  // mutation #128 survived: the URL was not part of the request fingerprint, so a different track
  // with a reused key silently replayed the first one; the user thinks it was added but it is not there
  it('the same Idempotency-Key with a different URL is 422 and adds nothing', async () => {
    const room = await w.room(owner);
    await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaaaaaa', 'key-12345'));

    await expect(w.as(owner, () => addTrack(room.code, 'https://youtu.be/bbbbbbbbbbb', 'key-12345'))).rejects.toMatchObject({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(await w.order(room)).toEqual([]);
  });

  // mutation #127 survived: without the room in the scope, the same key and URL in another room
  // replayed the first room's answer and nothing was added to the second room
  it('the same Idempotency-Key and URL in another room is 422, not a replay of the first room', async () => {
    const first = await w.room(owner);
    const second = await w.room(owner);
    await w.as(owner, () => addTrack(first.code, 'https://youtu.be/aaaaaaaaaaa', 'key-12345'));

    await expect(w.as(owner, () => addTrack(second.code, 'https://youtu.be/aaaaaaaaaaa', 'key-12345'))).rejects.toMatchObject({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect((await w.repos.playback.get(second.id)).currentItemId).toBeNull();
  });

  // mutation #130 survived: with the overwrite flag inverted, a fallback title ("Трек YouTube") overwrote
  // a real one in every room, and a track first stored with the fallback never got its real title
  it('a fallback title never overwrites a real one; a real title replaces an earlier fallback', async () => {
    const room = await w.room(owner);
    const providerUp = deps().metadata;
    const providerDown = { fetch: () => Promise.reject(new Error('provider down')) };
    const titleOf = async (r: Awaited<ReturnType<typeof addTrack>>) => (await w.repos.tracks.findById(r.body.item.track.id))?.title;

    const good = await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaa0001', undefined));
    deps().metadata = providerDown;
    const again = await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaa0001', undefined));
    expect(again.body.metadataFallback).toBe(true);
    expect(await titleOf(good)).toBe('Static track 0001');

    const fallback = await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaa0002', undefined));
    expect(await titleOf(fallback)).toBe('Трек YouTube');
    deps().metadata = providerUp;
    await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaa0002', undefined));
    expect(await titleOf(fallback)).toBe('Static track 0002');
  });

  // mutation #139 survived: the in-memory store accepts any kind, but PostgreSQL has
  // CHECK (kind IN ('user','system')), so a wrong kind would fail every add with 500 in production
  it('the chat announcement of an added track is a system message without an author', async () => {
    const room = await w.room(owner, alice);
    await w.as(alice, () => addTrack(room.code, 'https://youtu.be/bbbbbbbbbbb', undefined));

    const announcement = (await w.repos.messages.recent(room.id, 10)).find((m) => m.text === 'alice додав(ла) «Static track bbbb»');
    expect(announcement).toMatchObject({ kind: 'system', userId: null });
  });

  it('a retry with the same Idempotency-Key replays the first answer and adds nothing', async () => {
    const room = await w.room(owner);

    const a = await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaaaaaa', 'key-12345'));
    const b = await w.as(owner, () => addTrack(room.code, 'https://youtu.be/aaaaaaaaaaa', 'key-12345'));

    expect(b).toEqual({ ...a, replayed: true });
    expect(w.events.filter((e) => e.reason === 'track-added')).toHaveLength(1);
    expect((await w.repos.playback.get(room.id)).currentItemId).toBe(a.body.item.id);
    expect(await w.order(room)).toEqual([]);
  });

  it('non-members cannot add: 403; a bad link: 400', async () => {
    const room = await w.room(owner);
    await expect(w.as(carl, () => addTrack(room.code, 'https://youtu.be/aaaaaaaaaaa', undefined))).rejects.toMatchObject({ status: 403 });
    await expect(w.as(owner, () => addTrack(room.code, 'not a link', undefined))).rejects.toMatchObject({ status: 400 });
  });
});

describe('upcoming', () => {
  it('lists queued tracks in play order for members only', async () => {
    const room = await w.room(owner, alice);
    const a = await w.put(room, alice);
    const b = await w.put(room, owner, { locked: true });

    const { queue } = await w.as(owner, () => upcoming(room.code));

    expect(queue.map((q) => [q.id, q.addedBy, q.isPremium, q.locked, q.status])).toEqual([
      [a.id, 'alice', true, false, 'queued'],
      [b.id, 'owner', false, true, 'queued'],
    ]);
    await expect(w.as(carl, () => upcoming(room.code))).rejects.toMatchObject({ status: 403 });
  });
});
