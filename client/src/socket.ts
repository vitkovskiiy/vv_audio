import { io, type Socket } from 'socket.io-client';

interface ServerToClient {
  'room:changed': (e: { code: string; reason: string }) => void;
  'room:deleted': (e: { code: string }) => void;
}
interface ClientToServer {
  subscribe: (code: string, ack: (res: { ok: boolean; error?: string }) => void) => void;
}

/** notifications only: "room X changed"; the state itself is always read over HTTP */
export const socket: Socket<ServerToClient, ClientToServer> = io({ autoConnect: false });

/** server clock minus local clock, in ms; refined from every state response */
let offsetMs = 0;
let bestRtt = Infinity;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** NTP-style: keep the estimate from the fastest round trip seen */
export function observeServerTime(serverIso: string, sentAt: number, receivedAt: number) {
  const rtt = receivedAt - sentAt;
  if (rtt > bestRtt) return;
  bestRtt = rtt;
  offsetMs = new Date(serverIso).getTime() - (sentAt + receivedAt) / 2;
}
