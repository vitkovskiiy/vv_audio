import express from 'express';
import multer from 'multer';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';
import type {
  ChatMessage,
  ClientToServer,
  ControlAction,
  Favorite,
  Member,
  RoomState,
  ServerToClient,
  Source,
  Track,
  User,
} from '../shared/types';
import { attachUser, authRouter, requireAuth, userFromCookie } from './auth';
import { favoritesDb, messagesDb, roomsDb } from './db';
import { resolveUrl } from './resolve';
import { search, searchSources } from './search';

try {
  process.loadEnvFile();
} catch {
  // .env is optional: without keys only link-adding works
}

const PORT = Number(process.env.PORT) || 3001;
const ROOT = process.cwd();
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DIST_DIR = path.join(ROOT, 'dist');
const MEDIA_EXT = ['.mp3', '.m4a', '.ogg', '.wav', '.mp4', '.webm'];
const MAX_UPLOAD_MB = 200;
const FILE_REF_RE = /^\/uploads\/[\w-]+\.(mp3|m4a|ogg|wav|mp4|webm)$/;

mkdirSync(UPLOAD_DIR, { recursive: true });

interface Room {
  state: RoomState;
  members: Map<string, Member>;
}

/** live rooms; the database is the source of truth, this is a cache plus who is connected */
const rooms = new Map<string, Room>();

function getRoom(id: string): Room | undefined {
  let room = rooms.get(id);
  if (!room) {
    const stored = roomsDb.load(id);
    if (!stored) return undefined;
    room = { state: { ...stored, isPlaying: false, updatedAtServerMs: Date.now() }, members: new Map() };
    rooms.set(id, room);
  }
  return room;
}

function persist(id: string, s: RoomState) {
  roomsDb.save(id, { queue: s.queue, currentIndex: s.currentIndex, positionSec: currentPosition(s) });
}

function newRoomId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id: string;
  do {
    id = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  } while (roomsDb.exists(id));
  return id;
}

function currentPosition(s: RoomState): number {
  return s.isPlaying ? s.positionSec + (Date.now() - s.updatedAtServerMs) / 1000 : s.positionSec;
}

function goTo(s: RoomState, index: number) {
  if (index >= 0 && index < s.queue.length) {
    s.currentIndex = index;
    s.positionSec = 0;
  } else if (index >= s.queue.length) {
    // queue finished: point past the end so the next added track becomes current
    s.currentIndex = s.queue.length;
    s.isPlaying = false;
    s.positionSec = 0;
  }
}

function applyControl(s: RoomState, a: ControlAction) {
  const pos = currentPosition(s);
  switch (a.type) {
    case 'play':
      if (!s.queue[s.currentIndex]) return;
      s.positionSec = a.positionSec ?? pos;
      s.isPlaying = true;
      break;
    case 'pause':
      s.positionSec = a.positionSec ?? pos;
      s.isPlaying = false;
      break;
    case 'seek':
      s.positionSec = Math.max(0, a.positionSec);
      break;
    case 'next':
      goTo(s, s.currentIndex + 1);
      break;
    case 'prev':
      if (s.currentIndex === 0 || (pos > 3 && s.queue[s.currentIndex])) s.positionSec = 0;
      else goTo(s, s.currentIndex - 1);
      break;
    case 'select':
      if (!s.queue[a.index]) return;
      goTo(s, a.index);
      s.isPlaying = true;
      break;
    case 'remove': {
      if (a.index < 0 || a.index >= s.queue.length) return;
      s.queue.splice(a.index, 1);
      if (s.queue.length === 0) {
        s.currentIndex = -1;
        s.isPlaying = false;
        s.positionSec = 0;
      } else if (a.index < s.currentIndex) {
        s.currentIndex--;
        s.positionSec = pos;
      } else if (a.index === s.currentIndex) {
        if (s.currentIndex >= s.queue.length) {
          s.currentIndex = s.queue.length - 1;
          s.isPlaying = false;
        }
        s.positionSec = 0;
      } else {
        s.positionSec = pos;
      }
      break;
    }
  }
  s.updatedAtServerMs = Date.now();
}

const REF_RE: Record<Source, RegExp> = {
  file: FILE_REF_RE,
  youtube: /^[\w-]{6,20}$/,
  spotify: /^spotify:track:[A-Za-z0-9]{22}$/,
  soundcloud: /^https:\/\/soundcloud\.com\/[^\s]{1,300}$/,
};

function parseFavorite(body: unknown): Favorite | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const source = b.source as Source;
  const ref = String(b.ref ?? '');
  if (!(source in REF_RE) || !REF_RE[source].test(ref)) return null;
  const thumb = typeof b.thumbnail === 'string' && /^https:\/\/\S{1,500}$/.test(b.thumbnail) ? b.thumbnail : undefined;
  return {
    source,
    ref,
    title: String(b.title ?? 'Без названия').slice(0, 200),
    artist: typeof b.artist === 'string' ? b.artist.slice(0, 200) : undefined,
    thumbnail: thumb,
  };
}

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServer, ServerToClient, Record<string, never>, { user: User }>(httpServer, {
  maxHttpBufferSize: 1e5,
});

// behind a local tunnel (cloudflared, ngrok) trust its X-Forwarded-* headers for IP and https
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '20kb' }));
app.use(attachUser);
app.use('/api/auth', authRouter);
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { maxAge: '1h' }));

app.post('/api/rooms', requireAuth, (req, res) => {
  const id = newRoomId();
  roomsDb.create(id, req.user!.id, { queue: [], currentIndex: -1, positionSec: 0 });
  roomsDb.visit(req.user!.id, id);
  res.json({ roomId: id });
});

app.get('/api/rooms/mine', requireAuth, (req, res) => {
  res.json({ rooms: roomsDb.mine(req.user!.id) });
});

app.delete('/api/rooms/mine/:id', requireAuth, (req, res) => {
  roomsDb.forget(req.user!.id, String(req.params.id));
  res.json({ ok: true });
});

app.get('/api/favorites', requireAuth, (req, res) => {
  res.json({ favorites: favoritesDb.list(req.user!.id) });
});

app.post('/api/favorites', requireAuth, (req, res) => {
  const fav = parseFavorite(req.body);
  if (!fav) {
    res.status(400).json({ error: 'Этот трек нельзя добавить в избранное' });
    return;
  }
  favoritesDb.add(req.user!.id, fav);
  res.json({ ok: true });
});

app.delete('/api/favorites', requireAuth, (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  favoritesDb.remove(req.user!.id, String(b.source ?? ''), String(b.ref ?? ''));
  res.json({ ok: true });
});

app.get('/api/search/sources', requireAuth, (_req, res) => {
  res.json({ sources: searchSources() });
});

app.get('/api/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200);
  if (!q) {
    res.status(400).json({ error: 'Пустой запрос' });
    return;
  }
  res.json({ groups: await search(q) });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, MEDIA_EXT.includes(path.extname(file.originalname).toLowerCase())),
});

app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({ error: tooBig ? `Файл больше ${MAX_UPLOAD_MB} МБ` : 'Не удалось загрузить файл' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Поддерживаются mp3, m4a, ogg, wav, mp4 и webm' });
      return;
    }
    // multer decodes non-ASCII names as latin1
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.json({ ref: `/uploads/${req.file.filename}`, title: path.parse(original).name });
  });
});

if (existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

io.use((socket, next) => {
  const user = userFromCookie(socket.request.headers.cookie);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  const name = user.username;
  let roomId: string | null = null;

  const room = () => (roomId ? getRoom(roomId) : undefined);
  const membersOf = (r: Room) => [...new Map([...r.members.values()].map((m) => [m.id, m])).values()];
  const broadcastState = () => {
    const r = room();
    if (!r || !roomId) return;
    persist(roomId, r.state);
    io.to(roomId).emit('state', r.state);
  };
  const broadcastMembers = () => {
    const r = room();
    if (r && roomId) io.to(roomId).emit('members', membersOf(r));
  };
  /** join/leave notices are not stored: reconnects would flood the history */
  const say = (text: string, opts: { system?: boolean; store?: boolean } = {}) => {
    if (!roomId) return;
    const msg: ChatMessage = { id: randomUUID(), name: opts.system ? '' : name, text, ts: Date.now(), system: opts.system };
    if (opts.store !== false) messagesDb.add(roomId, msg);
    io.to(roomId).emit('chat', msg);
  };
  const addTrack = (t: Omit<Track, 'id' | 'addedBy'>) => {
    const r = room();
    if (!r) return;
    r.state.queue.push({ ...t, id: randomUUID(), addedBy: name });
    if (!r.state.queue[r.state.currentIndex]) {
      r.state.currentIndex = r.state.queue.length - 1;
      r.state.isPlaying = false;
      r.state.positionSec = 0;
      r.state.updatedAtServerMs = Date.now();
    }
    broadcastState();
    say(`${name} добавил(а) «${t.title}»`, { system: true });
  };

  socket.on('timesync', (ack) => typeof ack === 'function' && ack(Date.now()));

  socket.on('join', (id, ack) => {
    if (typeof ack !== 'function') return;
    const cleanId = String(id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (roomId) return ack({ ok: false, error: 'Вы уже в комнате' });
    const r = cleanId ? getRoom(cleanId) : undefined;
    if (!r) return ack({ ok: false, error: 'Такой комнаты нет. Проверьте код или создайте новую' });
    roomId = cleanId;
    socket.join(roomId);
    r.members.set(socket.id, { id: String(user.id), name });
    roomsDb.visit(user.id, roomId);
    socket.emit('state', r.state);
    socket.emit('chatHistory', messagesDb.recent(roomId));
    broadcastMembers();
    say(`${name} зашёл(ла) в комнату`, { system: true, store: false });
    ack({ ok: true });
  });

  socket.on('chat', (text) => {
    const t = String(text ?? '').trim().slice(0, 500);
    if (t && roomId) say(t);
  });

  socket.on('control', (action) => {
    const r = room();
    if (!r || !action || typeof action !== 'object') return;
    applyControl(r.state, action);
    broadcastState();
  });

  socket.on('ended', (trackId) => {
    const r = room();
    if (!r) return;
    // every client reports the end; only the first report for the current track advances
    if (r.state.queue[r.state.currentIndex]?.id !== trackId) return;
    goTo(r.state, r.state.currentIndex + 1);
    r.state.updatedAtServerMs = Date.now();
    broadcastState();
  });

  socket.on('addUrl', async (url, ack) => {
    if (typeof ack !== 'function') return;
    if (!room()) return ack({ ok: false, error: 'Сначала войдите в комнату' });
    try {
      addTrack(await resolveUrl(String(url ?? '')));
      ack({ ok: true });
    } catch (e) {
      ack({ ok: false, error: e instanceof Error ? e.message : 'Не удалось добавить трек' });
    }
  });

  socket.on('addFile', (data, ack) => {
    if (typeof ack !== 'function') return;
    if (!room()) return ack({ ok: false, error: 'Сначала войдите в комнату' });
    const ref = data?.ref;
    if (typeof ref !== 'string' || !FILE_REF_RE.test(ref)) return ack({ ok: false, error: 'Некорректный файл' });
    addTrack({ source: 'file', ref, title: String(data.title ?? 'Без названия').slice(0, 200) });
    ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const r = room();
    if (!r || !roomId) return;
    r.members.delete(socket.id);
    broadcastMembers();
    // only announce leaving when this was the user's last tab in the room
    if (![...r.members.values()].some((m) => m.id === String(user.id))) {
      say(`${name} вышел(ла)`, { system: true, store: false });
    }
    if (r.members.size === 0) {
      persist(roomId, r.state);
      rooms.delete(roomId);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`VV Audio server: http://localhost:${PORT}`);
});
