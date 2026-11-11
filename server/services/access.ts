import { deps } from '../container';
import { currentContext } from '../context';
import type { Member, Room, User } from '../domain/types';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../errors';

/** the user who started this operation, taken from the request context */
export function requireUser(): User {
  const user = currentContext()?.user;
  if (!user) throw new UnauthenticatedError();
  return user;
}

export function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

export async function findRoom(code: string): Promise<Room> {
  const room = await deps().repos.rooms.findByCode(normalizeCode(code));
  if (!room) throw new NotFoundError('Такої кімнати немає');
  return room;
}

/** room + the caller's membership; non-members get 403 */
export async function requireMember(code: string): Promise<{ room: Room; member: Member; user: User }> {
  const user = requireUser();
  const room = await findRoom(code);
  const member = await deps().repos.members.find(room.id, user.id);
  if (!member) throw new ForbiddenError('Ви не учасник цієї кімнати');
  return { room, member, user };
}

export async function requireOwner(code: string): Promise<{ room: Room; member: Member; user: User }> {
  const ctx = await requireMember(code);
  if (ctx.member.role !== 'owner') throw new ForbiddenError('Це може робити лише власник кімнати');
  return ctx;
}
