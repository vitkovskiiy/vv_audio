import { deps } from '../container';
import { log } from '../context';
import { roomCode } from '../domain/ids';
import { PaymentRequiredError } from '../errors';
import { findRoom, requireMember, requireOwner, requireUser } from './access';
import { memberDto, messageDto, playbackDto, queueItemDto, requestDto, roomSummaryDto } from './dto';
import { idempotent } from './idempotency';

export const FREE_ROOM_LIMIT = 5;
const HISTORY = 50;

async function uniqueCode(): Promise<string> {
  for (;;) {
    const code = roomCode();
    if (!(await deps().repos.rooms.codeExists(code))) return code;
  }
}

/** K5: free plan owns at most 5 rooms; premium has no limit. K13: room, owner and playback appear together or not at all */
export async function createRoom(idempotencyKey: string | undefined) {
  const user = requireUser();
  const { repos } = deps();
  const code = await uniqueCode();
  return idempotent(idempotencyKey, 'rooms:create', null, 201, async () => {
    // two parallel creates must not both pass the limit check
    await repos.users.lock(user.id);
    if (user.plan === 'free' && (await repos.rooms.countOwnedBy(user.id)) >= FREE_ROOM_LIMIT) {
      throw new PaymentRequiredError(
        'ROOM_LIMIT_EXCEEDED',
        `На безкоштовному плані можна мати до ${FREE_ROOM_LIMIT} кімнат. Є кімната, де тусовка вже закінчилась? Видаліть її або оформіть преміум.`,
      );
    }
    const room = await repos.rooms.create(code);
    await repos.members.add({ roomId: room.id, userId: user.id, role: 'owner' });
    await repos.playback.create(room.id);
    await repos.messages.add({ roomId: room.id, userId: null, kind: 'system', text: `${user.username} створив(ла) кімнату` });
    log().info({ room: room.code }, 'room created');
    return { code: room.code };
  });
}

export async function joinRoom(code: string) {
  const user = requireUser();
  const room = await findRoom(code);
  const { repos, events } = deps();
  const joined = await repos.transaction(async () => {
    if (await repos.members.find(room.id, user.id)) {
      await repos.members.touch(room.id, user.id);
      return false;
    }
    await repos.members.add({ roomId: room.id, userId: user.id, role: 'member' });
    await repos.messages.add({ roomId: room.id, userId: null, kind: 'system', text: `${user.username} приєднався(лась)` });
    return true;
  });
  if (joined) events.roomChanged(room.code, 'member-joined');
  return roomState(room.code);
}

/** everything a client needs to render the room; a fixed number of repository calls whatever the queue size */
export async function roomState(code: string) {
  const { room, member, user } = await requireMember(code);
  const { repos } = deps();
  const [playback, upcoming, members, pending, messages] = await Promise.all([
    repos.playback.get(room.id),
    repos.queue.upcoming(room.id),
    repos.members.list(room.id),
    repos.requests.pending(room.id),
    repos.messages.recent(room.id, HISTORY),
  ]);
  const current = playback.currentItemId ? await repos.queue.entry(playback.currentItemId) : undefined;
  const isOwner = member.role === 'owner';
  return {
    code: room.code,
    me: { username: user.username, role: member.role, plan: user.plan },
    serverTime: new Date().toISOString(),
    playback: playbackDto(playback, current),
    queue: upcoming.map(queueItemDto),
    members: members.map(memberDto),
    // the owner decides on every request; members see only their own
    requests: pending
      .filter((r) => isOwner || r.requestedBy === user.id)
      .map((r) => requestDto(r, members.find((m) => m.userId === r.requestedBy)?.username ?? '?')),
    messages: messages.map(messageDto),
  };
}

export async function myRooms() {
  const user = requireUser();
  const rooms = await deps().repos.rooms.summariesFor(user.id);
  return { rooms: rooms.map(roomSummaryDto) };
}

/** K18: only the owner; queue, chat and requests go with it and it disappears from everyone's list */
export async function deleteRoom(code: string) {
  const { room } = await requireOwner(code);
  const { repos, events } = deps();
  await repos.transaction(() => repos.rooms.delete(room.id));
  log().info({ room: room.code }, 'room deleted');
  events.roomDeleted(room.code);
}
