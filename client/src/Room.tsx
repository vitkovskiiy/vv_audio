import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  SOURCE_LABEL,
  trackUrl,
  type ChatMessage,
  type ControlAction,
  type Favorite,
  type Member,
  type RoomState,
  type Source,
  type User,
} from '../../shared/types';
import { api } from './api';
import { ThemeToggle } from './ThemeToggle';
import { CloseIcon, HeartIcon, LinkIcon, LogoutIcon, NextIcon, PauseIcon, PlayIcon, PlusIcon, PrevIcon, SendIcon, UploadIcon } from './icons';
import { Search } from './Search';
import { socket, syncClock } from './socket';
import { SyncEngine } from './sync';
import { useViewMode, type Theme } from './theme';

const MAX_UPLOAD_MB = 200;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** stable hue per nickname for avatars */
function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" style={{ '--h': hue(name) } as CSSProperties}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

interface Props {
  roomId: string;
  user: User;
  theme: Theme;
  toggleTheme: () => void;
  onLeave: () => void;
  onLogout: () => void;
}

const favKey = (t: { source: Source; ref: string }) => `${t.source}|${t.ref}`;

export function Room({ roomId, user, theme, toggleTheme, onLeave, onLogout }: Props) {
  const name = user.username;
  const [fatal, setFatal] = useState('');
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [tab, setTab] = useState<'queue' | 'favorites'>('queue');
  const [state, setState] = useState<RoomState | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [chatText, setChatText] = useState('');
  const [progress, setProgress] = useState({ time: 0, duration: 0 });
  const [dragging, setDragging] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useViewMode();

  const ytRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const spRef = useRef<HTMLDivElement>(null);
  const fileMediaRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? '' : n)), 6000);
  };

  useEffect(() => {
    const engine = new SyncEngine(
      { file: fileMediaRef.current!, youtube: ytRef.current!, soundcloud: scRef.current!, spotify: spRef.current! },
      {
        onEnded: (id) => socket.emit('ended', id),
        onError: (track, message) => flash(`«${track.title}»: ${message}. Трек пропущен.`),
        onHint: setHint,
        onActiveSource: setActiveSource,
      },
    );
    engineRef.current = engine;

    socket.on('connect', async () => {
      await syncClock();
      socket.emit('join', roomId, (res) => {
        if (res.ok) setConnected(true);
        else setFatal(res.error);
      });
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') window.dispatchEvent(new Event('vv-unauthorized'));
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s) => {
      setState(s);
      engine.setState(s);
    });
    socket.on('members', setMembers);
    socket.on('chatHistory', setChat);
    socket.on('chat', (m) => setChat((c) => [...c.slice(-199), m]));
    socket.connect();

    const resync = window.setInterval(() => socket.connected && syncClock(), 60000);
    const tick = window.setInterval(() => setProgress({ time: engine.currentTime(), duration: engine.duration() }), 500);

    return () => {
      window.clearInterval(resync);
      window.clearInterval(tick);
      engine.stop();
      socket.off();
      socket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    api<{ favorites: Favorite[] }>('/api/favorites')
      .then((d) => setFavorites(d.favorites))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const control = (a: ControlAction) => socket.emit('control', a);

  const enableAudio = () => {
    engineRef.current?.start();
    setAudioOn(true);
  };

  const addUrl = (u: string) =>
    new Promise<boolean>((resolve) => {
      socket.emit('addUrl', u, (res) => {
        if (!res.ok) flash(res.error);
        resolve(res.ok);
      });
    });

  const uploadFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return flash(`Файл больше ${MAX_UPLOAD_MB} МБ`);
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      socket.emit('addFile', data, (r) => !r.ok && flash(r.error));
    } catch (e) {
      flash(e instanceof Error && e.message ? e.message : 'Не удалось загрузить файл');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const t = chatText.trim();
    if (!t) return;
    socket.emit('chat', t);
    setChatText('');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${roomId}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      flash(`Ссылка на комнату: ${location.origin}/?room=${roomId}`);
    }
  };

  const favSet = new Set(favorites.map(favKey));

  const toggleFavorite = async (t: Favorite) => {
    const on = favSet.has(favKey(t));
    const fav: Favorite = { source: t.source, ref: t.ref, title: t.title, artist: t.artist, thumbnail: t.thumbnail };
    setFavorites((list) => (on ? list.filter((f) => favKey(f) !== favKey(t)) : [fav, ...list]));
    try {
      await api('/api/favorites', { method: on ? 'DELETE' : 'POST', body: fav });
    } catch (e) {
      setFavorites((list) => (on ? [fav, ...list] : list.filter((f) => favKey(f) !== favKey(t))));
      flash(e instanceof Error ? e.message : 'Не удалось обновить избранное');
    }
  };

  const queueFavorite = (f: Favorite) => {
    const url = trackUrl(f);
    if (url) return addUrl(url);
    return new Promise<boolean>((resolve) =>
      socket.emit('addFile', { ref: f.ref, title: f.title }, (r) => {
        if (!r.ok) flash(r.error);
        resolve(r.ok);
      }),
    );
  };

  const commitSeek = () => {
    if (dragging !== null) control({ type: 'seek', positionSec: dragging });
    setDragging(null);
  };

  const current = state?.queue[state.currentIndex];
  const playing = !!state?.isPlaying && !!current;
  const hasVideo = !!current && (current.source === 'youtube' || (current.source === 'file' && /\.(mp4|webm)$/i.test(current.ref)));
  const clip = hasVideo && viewMode === 'clip';
  const duration = progress.duration;
  const shownTime = dragging ?? progress.time;
  const pct = duration ? Math.min(100, (shownTime / duration) * 100) : 0;

  if (fatal) {
    return (
      <div className="home">
        <main className="fatal">
          <div className="panel overlay-card">
            <h2>Не получилось войти в комнату {roomId}</h2>
            <p className="muted">{fatal}</p>
            <button className="btn primary wide" onClick={onLeave}>
              На главную
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="room">
      <header className="topbar">
        <button className="brand" onClick={onLeave} title="На главную">
          VV Audio
        </button>
        <div className="room-chip">
          <span className={connected ? 'live on' : 'live'} title={connected ? 'Подключено' : 'Подключение…'} />
          <span className="muted">Комната</span>
          <b>{roomId}</b>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost small" onClick={copyLink}>
            <LinkIcon />
            {copied ? 'Ссылка скопирована' : 'Позвать друга'}
          </button>
          <ThemeToggle theme={theme} toggle={toggleTheme} />
          <button className="icon-btn" onClick={onLogout} title={`Выйти из аккаунта ${name}`} aria-label="Выйти из аккаунта">
            <LogoutIcon />
          </button>
        </div>
      </header>

      {!audioOn && (
        <div className="overlay">
          <div className="panel overlay-card">
            <h2>Почти готово</h2>
            <p className="muted">Браузер включает звук только после вашего нажатия. Один клик, и вы слушаете вместе со всеми.</p>
            <button className="btn primary wide" onClick={enableAudio}>
              Включить звук
            </button>
          </div>
        </div>
      )}

      <section
        className={`stage${clip ? ' is-clip' : ''}${playing ? ' is-playing' : ''}`}
        data-source={current?.source ?? 'none'}
        data-active={activeSource ?? 'none'}
        data-video={hasVideo ? 'yes' : 'no'}
      >
        <div className="stage-bg" style={current?.thumbnail ? { backgroundImage: `url("${current.thumbnail}")` } : undefined} />

        <div className="stage-media">
          <div className="cover">
            {current?.thumbnail ? <img src={current.thumbnail} alt="" /> : <span className="cover-empty">♪</span>}
          </div>
          <div ref={ytRef} className="embed embed-youtube" />
          <div ref={fileMediaRef} className="embed embed-file" />
        </div>

        <div className="stage-meta">
          {current ? (
            <>
              <span className={`badge ${current.source}`}>{SOURCE_LABEL[current.source]}</span>
              <h1 className="track-name">{current.title}</h1>
              <p className="track-sub">
                {current.artist && <span>{current.artist}</span>}
                <span className="muted">добавил(а) {current.addedBy}</span>
              </p>
            </>
          ) : (
            <>
              <h1 className="track-name quiet">Тишина</h1>
              <p className="track-sub muted">Найдите трек ниже или вставьте ссылку, и он заиграет у всех в комнате.</p>
            </>
          )}

          <div className="seek">
            <span className="time">{fmt(shownTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.5}
              value={Math.min(shownTime, duration || 1)}
              disabled={!current || !duration}
              style={{ '--pct': `${pct}%` } as CSSProperties}
              aria-label="Перемотка"
              onChange={(e) => setDragging(Number(e.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
            <span className="time">{fmt(duration)}</span>
          </div>

          <div className="controls">
            <button className="icon-btn" onClick={() => control({ type: 'prev' })} disabled={!state?.queue.length} aria-label="Предыдущий трек">
              <PrevIcon />
            </button>
            <button
              className="play-btn"
              onClick={() => control({ type: playing ? 'pause' : 'play' })}
              disabled={!current}
              aria-label={playing ? 'Пауза' : 'Играть'}
            >
              {playing ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
            </button>
            <button className="icon-btn" onClick={() => control({ type: 'next' })} disabled={!current} aria-label="Следующий трек">
              <NextIcon />
            </button>
            {current && (
              <button
                className={`icon-btn heart${favSet.has(favKey(current)) ? ' on' : ''}`}
                onClick={() => toggleFavorite(current)}
                aria-pressed={favSet.has(favKey(current))}
                aria-label={favSet.has(favKey(current)) ? 'Убрать из избранного' : 'В избранное'}
              >
                <HeartIcon filled={favSet.has(favKey(current))} />
              </button>
            )}

            {hasVideo && (
              <div className="segmented" role="group" aria-label="Вид">
                <button className={viewMode === 'audio' ? 'on' : ''} onClick={() => setViewMode('audio')}>
                  Звук
                </button>
                <button className={viewMode === 'clip' ? 'on' : ''} onClick={() => setViewMode('clip')}>
                  Клип
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="stage-widgets">
          <div ref={scRef} className="embed embed-soundcloud" />
          <div ref={spRef} className="embed embed-spotify" />
          {hint && <p className="hint">{hint}</p>}
        </div>
      </section>

      <section className="queue panel">
        <div className="panel-head">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>
              Очередь
              {state?.queue.length ? <span className="count">{state.queue.length}</span> : null}
            </button>
            <button role="tab" aria-selected={tab === 'favorites'} className={tab === 'favorites' ? 'on' : ''} onClick={() => setTab('favorites')}>
              Избранное
              {favorites.length ? <span className="count">{favorites.length}</span> : null}
            </button>
          </div>
        </div>
        {tab === 'favorites' ? (
          favorites.length ? (
            <ul className="tracks">
              {favorites.map((f) => (
                <li key={favKey(f)}>
                  <span className="track static">
                    {f.thumbnail ? <img src={f.thumbnail} alt="" /> : <span className="thumb-empty">♪</span>}
                    <span className="track-text">
                      <span className="track-title">{f.title}</span>
                      <span className="muted small">
                        {f.artist ? `${f.artist}, ` : ''}
                        {SOURCE_LABEL[f.source]}
                      </span>
                    </span>
                  </span>
                  <button className="icon-btn subtle heart on" onClick={() => toggleFavorite(f)} aria-label={`Убрать «${f.title}» из избранного`}>
                    <HeartIcon filled />
                  </button>
                  <button className="icon-btn accent small-btn" onClick={() => queueFavorite(f)} aria-label={`Добавить «${f.title}» в очередь`}>
                    <PlusIcon />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty muted">Здесь будут треки, которые вы отметили сердечком. Избранное видно только вам и хранится в аккаунте.</p>
          )
        ) : (
          <>
        <Search addUrl={addUrl} />
        <label className={`upload${uploading ? ' busy' : ''}`}>
          <input
            ref={uploadRef}
            type="file"
            accept=".mp3,.m4a,.ogg,.wav,.mp4,.webm,audio/*,video/mp4,video/webm"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
          />
          <UploadIcon />
          <span>{uploading ? 'Загружаем файл…' : 'Загрузить свой файл'}</span>
          <span className="muted small">mp3, m4a, ogg, wav, mp4, webm до {MAX_UPLOAD_MB} МБ</span>
        </label>
        {notice && <p className="error">{notice}</p>}

        {state?.queue.length ? (
          <ol className="tracks">
            {state.queue.map((t, i) => (
              <li key={t.id} className={i === state.currentIndex ? 'current' : i < state.currentIndex ? 'played' : ''}>
                <button className="track" onClick={() => control({ type: 'select', index: i })} title="Включить этот трек">
                  {t.thumbnail ? <img src={t.thumbnail} alt="" /> : <span className="thumb-empty">♪</span>}
                  <span className="track-text">
                    <span className="track-title">{t.title}</span>
                    <span className="muted small">
                      {t.artist ? `${t.artist}, ` : ''}
                      {SOURCE_LABEL[t.source]}
                    </span>
                  </span>
                  {i === state.currentIndex && playing && (
                    <span className="eq" aria-label="Играет">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </button>
                <button
                  className={`icon-btn subtle heart${favSet.has(favKey(t)) ? ' on' : ''}`}
                  onClick={() => toggleFavorite(t)}
                  aria-pressed={favSet.has(favKey(t))}
                  aria-label={favSet.has(favKey(t)) ? `Убрать «${t.title}» из избранного` : `«${t.title}» в избранное`}
                >
                  <HeartIcon filled={favSet.has(favKey(t))} />
                </button>
                <button className="icon-btn subtle" onClick={() => control({ type: 'remove', index: i })} aria-label={`Убрать «${t.title}»`}>
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty muted">Пока пусто. Первый трек сразу станет текущим.</p>
        )}
          </>
        )}
      </section>

      <aside className="side panel">
        <div className="panel-head">
          <h2>В комнате</h2>
          <span className="muted small">{members.length}</span>
        </div>
        <ul className="members">
          {members.map((m) => (
            <li key={m.id}>
              <Avatar name={m.name} />
              <span>{m.name}</span>
              {m.name === name && <span className="muted small">вы</span>}
            </li>
          ))}
        </ul>

        <div className="panel-head">
          <h2>Чат</h2>
        </div>
        <div className="chat" ref={chatRef}>
          {chat.length === 0 && <p className="muted small">Сообщений пока нет.</p>}
          {chat.map((m) =>
            m.system ? (
              <div key={m.id} className="msg system">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={`msg${m.name === name ? ' mine' : ''}`}>
                <Avatar name={m.name} />
                <div>
                  <b>{m.name}</b>
                  <p>{m.text}</p>
                </div>
              </div>
            ),
          )}
        </div>
        <form className="chat-form" onSubmit={sendChat}>
          <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Написать в чат" maxLength={500} />
          <button type="submit" className="icon-btn accent" disabled={!chatText.trim()} aria-label="Отправить">
            <SendIcon />
          </button>
        </form>
      </aside>
    </div>
  );
}
