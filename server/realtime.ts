import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { RoomEvents } from './container';
import { log, newBpId, runInContext } from './context';
import type { User } from './domain/types';
import { requireMember } from './services/access';
import { userForToken } from './services/auth.service';
import { SESSION_COOKIE } from './routes/http';

interface ClientToServer {
  subscribe(code: string, ack: (res: { ok: boolean; error?: string }) => void): void;
}
interface ServerToClient {
  'room:changed'(e: { code: string; reason: string }): void;
  'room:deleted'(e: { code: string }): void;
}

function cookieValue(header: string | undefined, name: string) {
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Socket.IO only notifies: "room X changed". Clients then re-read state over HTTP,
 * so every business operation keeps a single entry point (the REST API).
 */
export function attachRealtime(server: HttpServer): RoomEvents & { close(): Promise<void> } {
  const io = new Server<ClientToServer, ServerToClient, Record<string, never>, { user: User }>(server, { maxHttpBufferSize: 1e4 });

  io.use((socket, next) => {
    runInContext({ bpId: newBpId() }, async () => {
      const user = await userForToken(cookieValue(socket.request.headers.cookie, SESSION_COOKIE));
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    }).catch(next);
  });

  io.on('connection', (socket) => {
    socket.on('subscribe', (code, ack) => {
      if (typeof ack !== 'function') return;
      // each socket event is its own business process with its own bpId
      void runInContext({ bpId: newBpId(), user: socket.data.user }, async () => {
        try {
          const { room } = await requireMember(String(code));
          await socket.join(room.code);
          ack({ ok: true });
        } catch (err) {
          log().info({ err: String(err) }, 'subscribe refused');
          ack({ ok: false, error: err instanceof Error ? err.message : 'refused' });
        }
      });
    });
  });

  return {
    roomChanged: (code, reason) => io.to(code).emit('room:changed', { code, reason }),
    roomDeleted: (code) => io.to(code).emit('room:deleted', { code }),
    close: () => io.close(),
  };
}
