import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../../shared/types';

export type AppSocket = Socket<ServerToClient, ClientToServer>;

export const socket: AppSocket = io({ autoConnect: false });

/** server clock minus local clock, in ms */
let offsetMs = 0;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** NTP-style estimate: keep the sample with the smallest round trip. */
export async function syncClock(samples = 6): Promise<void> {
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const server = await new Promise<number>((resolve) => socket.emit('timesync', resolve));
    const t1 = Date.now();
    const rtt = t1 - t0;
    if (rtt < best.rtt) best = { rtt, offset: server - (t0 + t1) / 2 };
  }
  offsetMs = best.offset;
}
