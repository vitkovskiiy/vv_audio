import { randomBytes } from 'node:crypto';

/** UUIDv7 (RFC 9562): 48-bit unix-ms timestamp + random; same format PostgreSQL 18's uuidv7() produces */
export function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 6-character room code without look-alike characters (0/O, 1/I) */
export function roomCode(): string {
  return Array.from(randomBytes(6), (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
