import { deps } from '../container';
import type { Plan } from '../domain/types';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { requireMember, requireUser } from './access';
import { messageDto, trackDto, userDto } from './dto';
import { idempotent } from './idempotency';

const MAX_MESSAGE = 500;

export async function sendMessage(code: string, text: string, idempotencyKey: string | undefined) {
  const { room, user } = await requireMember(code);
  const clean = text.trim();
  if (!clean || clean.length > MAX_MESSAGE) throw new ValidationError(`Повідомлення: від 1 до ${MAX_MESSAGE} символів`);
  const { repos, events } = deps();
  const result = await idempotent(idempotencyKey, `chat:${room.id}`, { text: clean }, 201, async () => {
    const m = await repos.messages.add({ roomId: room.id, userId: user.id, kind: 'user', text: clean });
    return messageDto({ ...m, username: user.username });
  });
  if (!result.replayed) events.roomChanged(room.code, 'message');
  return result;
}

export async function messages(code: string, limit: number) {
  const { room } = await requireMember(code);
  return { messages: (await deps().repos.messages.recent(room.id, limit)).map(messageDto) };
}

export async function listFavorites() {
  const user = requireUser();
  return { favorites: (await deps().repos.favorites.list(user.id)).map(trackDto) };
}

export async function addFavorite(trackId: string) {
  const user = requireUser();
  const { repos } = deps();
  if (!(await repos.tracks.findById(trackId))) throw new NotFoundError('Такого треку немає');
  await repos.favorites.add(user.id, trackId);
}

export async function removeFavorite(trackId: string) {
  const user = requireUser();
  await deps().repos.favorites.remove(user.id, trackId);
}

/** monetisation stub: an admin switches the plan; real payments are out of scope */
export async function setPlan(username: string, plan: Plan) {
  const admin = requireUser();
  if (!admin.isAdmin) throw new ForbiddenError('Лише для адміністратора');
  const { repos } = deps();
  const target = await repos.users.findByUsername(username);
  if (!target) throw new NotFoundError('Такого користувача немає');
  await repos.users.setPlan(target.id, plan);
  return userDto({ ...target, plan });
}

export function me() {
  return { user: userDto(requireUser()) };
}
