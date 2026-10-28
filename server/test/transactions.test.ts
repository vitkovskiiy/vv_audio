import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { noEvents, setDeps } from '../container';
import { runInContext } from '../context';
import type { User } from '../domain/types';
import { configureLogger } from '../logger';
import { createMemoryRepositories } from '../repositories/memory';
import type { Repositories } from '../repositories/ports';
import { staticMetadata } from '../services/metadata';
import { createRoom } from '../services/rooms.service';

configureLogger(undefined, 'silent');

let repos: Repositories;
let user: User;
const asUser = <T>(fn: () => Promise<T>) => runInContext({ bpId: 'test', user }, fn);

beforeEach(async () => {
  repos = createMemoryRepositories();
  setDeps({ repos, metadata: staticMetadata, searchProviders: [], events: noEvents });
  user = await repos.users.create({ username: 'tx-owner', passHash: 'x' });
});

describe('K13: room creation is atomic', () => {
  it('a failure after the room row is written leaves no room, membership or playback behind', async () => {
    let createdCode = '';
    const create = repos.rooms.create.bind(repos.rooms);
    repos.rooms.create = async (code) => {
      createdCode = code;
      return create(code);
    };
    // the crash: the second write of the operation fails
    repos.members.add = async () => {
      throw new Error('simulated crash between writes');
    };

    await assert.rejects(asUser(() => createRoom(undefined)), /simulated crash/);

    assert.ok(createdCode, 'the room insert did run before the crash');
    assert.equal(await repos.rooms.codeExists(createdCode), false, 'room row was rolled back');
    assert.equal(await repos.rooms.countOwnedBy(user.id), 0, 'no ownership left');
    assert.deepEqual(await repos.rooms.summariesFor(user.id), [], 'nothing in "my rooms"');
  });

  it('without the failure the same operation creates room, owner and playback together', async () => {
    const { body } = await asUser(() => createRoom(undefined));
    const room = await repos.rooms.findByCode(body.code);
    assert.ok(room);
    assert.equal((await repos.members.find(room.id, user.id))?.role, 'owner');
    assert.equal((await repos.playback.get(room.id)).currentItemId, null);
  });
});

describe('transactions run one at a time', () => {
  it('a slow transaction is not interleaved with a concurrent one', async () => {
    const events: string[] = [];
    const slow = repos.transaction(async () => {
      events.push('A start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('A end');
    });
    const fast = repos.transaction(async () => {
      events.push('B');
    });
    await Promise.all([slow, fast]);
    assert.deepEqual(events, ['A start', 'A end', 'B']);
  });
});
