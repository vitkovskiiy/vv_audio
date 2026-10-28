import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { SOURCE_LABEL, trackUrl, type ApiTrack, type QueueItem, type RoomState, type Source, type User } from '../../shared/types';
import { api, ApiError, errorText } from './api';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  CrownIcon,
  FlagIcon,
  HeartIcon,
  LinkIcon,
  LogoutIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlayNextIcon,
  PlusIcon,
  SendIcon,
  TrashIcon,
} from './icons';
import { Search } from './Search';
import { observeServerTime, socket } from './socket';
import { SyncEngine } from './sync';
import { useViewMode, type Theme } from './theme';
import { ThemeToggle } from './ThemeToggle';

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
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

export function Room({ roomId: code, user, theme, toggleTheme, onLeave, onLogout }: Props) {
  const [state, setState] = useState<RoomState | null>(null);
  const [fatal, setFatal] = useState('');
  const [live, setLive] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [chatText, setChatText] = useState('');
  const [progress, setProgress] = useState({ time: 0, duration: 0 });
  const [dragging, setDragging] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [favorites, setFavorites] = useState<ApiTrack[]>([]);
  const [tab, setTab] = useState<'queue' | 'favorites'>('queue');
  const [viewMode, setViewMode] = useViewMode();

  const ytRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const spRef = useRef<HTMLDivElement>(null);
  const fileMediaRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const flash = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 6000);
  }, []);

  const apply = useCallback((s: RoomState) => {
    setState(s);
    engineRef.current?.setState(s.playback);
  }, []);

  /** the single way to read room state: over HTTP, also measuring the server clock */
  const refresh = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const s = await api<RoomState>(`/api/rooms/${code}`);
      observeServerTime(s.serverTime, sentAt, Date.now());
      apply(s);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setFatal(e.message);
    }
  }, [code, apply]);

  /** run an action, report its error, re-read the state */
  const act = useCallback(
    async (fn: () => Promise<unknown>, done?: string) => {
      try {
        await fn();
        if (done) flash(done);
      } catch (e) {
        flash(errorText(e), true);
      }
      await refresh();
    },
    [flash, refresh],
  );

  useEffect(() => {
    const engine = new SyncEngine(
      { file: fileMediaRef.current!, youtube: ytRef.current!, soundcloud: scRef.current!, spotify: spRef.current! },
      {
        onEnded: (itemId) => {
          api(`/api/rooms/${code}/playback/ended`, { body: { itemId } }).catch(() => {});
        },
        onError: (track, message) => flash(`«${track.title}»: ${message}`, true),
        onHint: setHint,
        onActiveSource: setActiveSource,
      },
    );
    engineRef.current = engine;

    let pending: number | undefined;
    // several changes in a burst become one re-read
    const scheduleRefresh = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(refresh, 80);
    };

    const sentAt = Date.now();
    api<RoomState>(`/api/rooms/${code}/join`, { method: 'POST' })
      .then((s) => {
        observeServerTime(s.serverTime, sentAt, Date.now());
        apply(s);
      })
      .catch((e) => setFatal(errorText(e)));

    socket.on('connect', () => socket.emit('subscribe', code, (res) => setLive(res.ok)));
    socket.on('disconnect', () => setLive(false));
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') window.dispatchEvent(new Event('vv-unauthorized'));
    });
    socket.on('room:changed', scheduleRefresh);
    socket.on('room:deleted', () => setFatal('Власник видалив цю кімнату'));
    socket.connect();

    // a safety net if a notification is lost
    const poll = window.setInterval(refresh, 15000);
    const tick = window.setInterval(() => setProgress({ time: engine.currentTime(), duration: engine.duration() }), 500);

    api<{ favorites: ApiTrack[] }>('/api/favorites')
      .then((d) => setFavorites(d.favorites))
      .catch(() => {});

    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      window.clearTimeout(pending);
      engine.stop();
      socket.off();
      socket.disconnect();
    };
  }, [code, apply, refresh, flash]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state?.messages.length]);

  if (fatal) {
    return (
      <div className="home">
        <main className="fatal">
          <div className="panel overlay-card">
            <h2>Кімната {code} недоступна</h2>
            <p className="muted">{fatal}</p>
            <button className="btn primary wide" onClick={onLeave}>
              На головну
            </button>
          </div>
        </main>
      </div>
    );
  }

  const me = state?.me;
  const isOwner = me?.role === 'owner';
  const isPremium = me?.plan === 'premium';
  const current = state?.playback.current ?? null;
  const playing = !!state?.playback.isPlaying && !!current;
  const hasVideo = !!current && (current.track.source === 'youtube' || (current.track.source === 'file' && /\.(mp4|webm)$/i.test(current.track.ref)));
  const clip = hasVideo && viewMode === 'clip';
  const duration = progress.duration;
  const shownTime = dragging ?? progress.time;
  const pct = duration ? Math.min(100, (shownTime / duration) * 100) : 0;
  const favIds = new Set(favorites.map((f) => f.id));
  const myPending = new Set(state?.requests.filter((r) => r.requestedBy === me?.username).map((r) => `${r.type}:${r.itemId}`));
  const titleOf = (itemId: string) =>
    (current?.id === itemId ? current : state?.queue.find((q) => q.id === itemId))?.track.title ?? 'трек, якого вже немає';

  const addUrl = async (url: string) => {
    try {
      const r = await api<{ metadataFallback: boolean }>(`/api/rooms/${code}/queue`, { body: { url }, idempotent: true });
      if (r.metadataFallback) flash('Трек додано, але назву джерело не віддало — показуємо загальну');
      await refresh();
      return true;
    } catch (e) {
      flash(errorText(e), true);
      return false;
    }
  };

  const toggleFavorite = (t: ApiTrack) => {
    const on = favIds.has(t.id);
    setFavorites((list) => (on ? list.filter((f) => f.id !== t.id) : [t, ...list]));
    api(`/api/favorites/${t.id}`, { method: on ? 'DELETE' : 'PUT' }).catch((e) => {
      setFavorites((list) => (on ? [t, ...list] : list.filter((f) => f.id !== t.id)));
      flash(errorText(e), true);
    });
  };

  const control = (action: 'play' | 'pause' | 'seek', positionSec?: number) =>
    act(() => api(`/api/rooms/${code}/playback`, { body: { action, positionSec } }));

  /** owner skips; everyone else asks the owner to */
  const next = () =>
    current &&
    (isOwner
      ? act(() => api(`/api/rooms/${code}/playback/next`, { body: { expectedItemId: current.id } }))
      : act(() => api(`/api/rooms/${code}/requests`, { body: { type: 'skip', itemId: current.id } }), 'Запит на пропуск надіслано власнику'));

  const commitSeek = () => {
    if (dragging !== null) control('seek', dragging);
    setDragging(null);
  };

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    await act(() => api(`/api/rooms/${code}/messages`, { body: { text }, idempotent: true }));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${code}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      flash(`Посилання: ${location.origin}/?room=${code}`);
    }
  };

  const deleteRoom = async () => {
    if (!confirm(`Видалити кімнату ${code} разом із чергою та чатом? Її не стане й в інших учасників.`)) return;
    try {
      await api(`/api/rooms/${code}`, { method: 'DELETE' });
      onLeave();
    } catch (e) {
      flash(errorText(e), true);
    }
  };

  const itemActions = (item: QueueItem) => {
    const mine = item.addedBy === me?.username;
    return (
      <>
        {isPremium && mine && (
          <>
            <button className="icon-btn subtle" onClick={() => act(() => api(`/api/rooms/${code}/queue/${item.id}/move`, { body: { direction: 'up' } }))} aria-label="Підняти вище">
              <ArrowUpIcon />
            </button>
            <button className="icon-btn subtle" onClick={() => act(() => api(`/api/rooms/${code}/queue/${item.id}/move`, { body: { direction: 'down' } }))} aria-label="Опустити нижче">
              <ArrowDownIcon />
            </button>
          </>
        )}
        {isOwner && (
          <button className="icon-btn subtle" onClick={() => act(() => api(`/api/rooms/${code}/queue/${item.id}/play-next`, { method: 'POST' }))} aria-label="Грати наступним" title="Грати наступним">
            <PlayNextIcon />
          </button>
        )}
        <button
          className={`icon-btn subtle heart${favIds.has(item.track.id) ? ' on' : ''}`}
          onClick={() => toggleFavorite(item.track)}
          aria-pressed={favIds.has(item.track.id)}
          aria-label={favIds.has(item.track.id) ? 'Прибрати з обраного' : 'В обране'}
        >
          <HeartIcon size={16} filled={favIds.has(item.track.id)} />
        </button>
        {isOwner || mine ? (
          <button className="icon-btn subtle" onClick={() => act(() => api(`/api/rooms/${code}/queue/${item.id}`, { method: 'DELETE' }))} aria-label={`Прибрати «${item.track.title}»`}>
            <CloseIcon />
          </button>
        ) : myPending.has(`remove:${item.id}`) ? (
          <span className="muted small pending-note">запит надіслано</span>
        ) : (
          <button
            className="icon-btn subtle"
            onClick={() => act(() => api(`/api/rooms/${code}/requests`, { body: { type: 'remove', itemId: item.id } }), 'Запит на видалення надіслано власнику')}
            aria-label={`Попросити власника прибрати «${item.track.title}»`}
            title="Попросити власника прибрати"
          >
            <FlagIcon />
          </button>
        )}
      </>
    );
  };

  return (
    <div className="room">
      <header className="topbar">
        <button className="brand" onClick={onLeave} title="На головну">
          VV Audio
        </button>
        <div className="room-chip">
          <span className={live ? 'live on' : 'live'} title={live ? 'Оновлення в реальному часі' : 'Підключення…'} />
          <span className="muted">Кімната</span>
          <b>{code}</b>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost small" onClick={copyLink}>
            <LinkIcon />
            {copied ? 'Скопійовано' : 'Покликати друга'}
          </button>
          {isOwner && (
            <button className="icon-btn" onClick={deleteRoom} title="Видалити кімнату" aria-label="Видалити кімнату">
              <TrashIcon />
            </button>
          )}
          <ThemeToggle theme={theme} toggle={toggleTheme} />
          <button className="icon-btn" onClick={onLogout} title={`Вийти з акаунта ${user.username}`} aria-label="Вийти з акаунта">
            <LogoutIcon />
          </button>
        </div>
      </header>

      {!audioOn && (
        <div className="overlay">
          <div className="panel overlay-card">
            <h2>Майже готово</h2>
            <p className="muted">Браузер вмикає звук лише після вашого натискання. Один клік — і ви слухаєте разом з усіма.</p>
            <button
              className="btn primary wide"
              onClick={() => {
                engineRef.current?.start();
                setAudioOn(true);
              }}
            >
              Увімкнути звук
            </button>
          </div>
        </div>
      )}

      <section
        className={`stage${clip ? ' is-clip' : ''}${playing ? ' is-playing' : ''}`}
        data-source={current?.track.source ?? 'none'}
        data-active={activeSource ?? 'none'}
      >
        <div className="stage-bg" style={current?.track.thumbnail ? { backgroundImage: `url("${current.track.thumbnail}")` } : undefined} />

        <div className="stage-media">
          <div className="cover">
            {current?.track.thumbnail ? <img src={current.track.thumbnail} alt="" /> : <span className="cover-empty">♪</span>}
          </div>
          <div ref={ytRef} className="embed embed-youtube" />
          <div ref={fileMediaRef} className="embed embed-file" />
        </div>

        <div className="stage-meta">
          {current ? (
            <>
              <span className={`badge ${current.track.source}`}>{SOURCE_LABEL[current.track.source]}</span>
              <h1 className="track-name">{current.track.title}</h1>
              <p className="track-sub">
                {current.track.artist && <span>{current.track.artist}</span>}
                <span className="muted">
                  додав(ла) {current.addedBy}
                  {current.isPremium ? ' ★' : ''}
                </span>
              </p>
            </>
          ) : (
            <>
              <h1 className="track-name quiet">Тиша</h1>
              <p className="track-sub muted">Знайдіть трек нижче або вставте посилання — він заграє в усіх у кімнаті.</p>
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
              disabled={!current || !duration || !isOwner}
              style={{ '--pct': `${pct}%` } as CSSProperties}
              aria-label="Перемотування"
              title={isOwner ? undefined : 'Перемотує власник кімнати'}
              onChange={(e) => setDragging(Number(e.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
            <span className="time">{fmt(duration)}</span>
          </div>

          <div className="controls">
            <button
              className="play-btn"
              onClick={() => control(playing ? 'pause' : 'play')}
              disabled={!current || !isOwner}
              aria-label={playing ? 'Пауза' : 'Грати'}
              title={isOwner ? undefined : 'Відтворенням керує власник кімнати'}
            >
              {playing ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
            </button>
            <button
              className="icon-btn"
              onClick={next}
              disabled={!current || (!isOwner && myPending.has(`skip:${current.id}`))}
              aria-label={isOwner ? 'Наступний трек' : 'Попросити пропустити'}
              title={isOwner ? 'Наступний трек' : 'Попросити власника пропустити'}
            >
              <NextIcon />
            </button>
            {current && (
              <button
                className={`icon-btn heart${favIds.has(current.track.id) ? ' on' : ''}`}
                onClick={() => toggleFavorite(current.track)}
                aria-pressed={favIds.has(current.track.id)}
                aria-label={favIds.has(current.track.id) ? 'Прибрати з обраного' : 'В обране'}
              >
                <HeartIcon filled={favIds.has(current.track.id)} />
              </button>
            )}
            {!isOwner && current && myPending.has(`skip:${current.id}`) && <span className="muted small">запит на пропуск надіслано</span>}

            {hasVideo && (
              <div className="segmented" role="group" aria-label="Вигляд">
                <button className={viewMode === 'audio' ? 'on' : ''} onClick={() => setViewMode('audio')}>
                  Звук
                </button>
                <button className={viewMode === 'clip' ? 'on' : ''} onClick={() => setViewMode('clip')}>
                  Кліп
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
              Черга
              {state?.queue.length ? <span className="count">{state.queue.length}</span> : null}
            </button>
            <button role="tab" aria-selected={tab === 'favorites'} className={tab === 'favorites' ? 'on' : ''} onClick={() => setTab('favorites')}>
              Обране
              {favorites.length ? <span className="count">{favorites.length}</span> : null}
            </button>
          </div>
        </div>

        {notice && <p className={notice.error ? 'error notice' : 'notice'}>{notice.text}</p>}

        {isOwner && !!state?.requests.length && (
          <div className="requests">
            <h3>Запити до вас</h3>
            <ul>
              {state.requests.map((r) => (
                <li key={r.id}>
                  <span>
                    <b>{r.requestedBy}</b> {r.type === 'skip' ? 'просить пропустити' : 'просить прибрати'} «{titleOf(r.itemId)}»
                  </span>
                  <span className="request-actions">
                    <button className="btn small primary" onClick={() => act(() => api(`/api/rooms/${code}/requests/${r.id}/decision`, { body: { decision: 'approve' } }))}>
                      Так
                    </button>
                    <button className="btn small ghost" onClick={() => act(() => api(`/api/rooms/${code}/requests/${r.id}/decision`, { body: { decision: 'reject' } }))}>
                      Ні
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'favorites' ? (
          favorites.length ? (
            <ul className="tracks">
              {favorites.map((f) => {
                const url = trackUrl(f);
                return (
                  <li key={f.id}>
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
                    <button className="icon-btn subtle heart on" onClick={() => toggleFavorite(f)} aria-label={`Прибрати «${f.title}» з обраного`}>
                      <HeartIcon size={16} filled />
                    </button>
                    {url && (
                      <button className="icon-btn accent small-btn" onClick={() => addUrl(url)} aria-label={`Додати «${f.title}» у чергу`}>
                        <PlusIcon />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty muted">Тут будуть треки, позначені сердечком. Обране бачите лише ви, воно зберігається в акаунті.</p>
          )
        ) : (
          <>
            <Search addUrl={addUrl} />
            {isPremium && <p className="muted small premium-note">★ Ви преміум: свої треки можна піднімати стрілками, але не вище чужого преміум-треку й не більше двох преміум поспіль.</p>}
            {state?.queue.length ? (
              <ol className="tracks">
                {state.queue.map((item) => (
                  <li key={item.id}>
                    <span className="track static">
                      {item.track.thumbnail ? <img src={item.track.thumbnail} alt="" /> : <span className="thumb-empty">♪</span>}
                      <span className="track-text">
                        <span className="track-title">
                          {item.isPremium && <span className="star" title="Преміум-трек">★ </span>}
                          {item.track.title}
                        </span>
                        <span className="muted small">
                          {item.track.artist ? `${item.track.artist}, ` : ''}
                          {SOURCE_LABEL[item.track.source]}, додав(ла) {item.addedBy}
                          {item.locked ? ', поставлено власником' : ''}
                        </span>
                      </span>
                    </span>
                    {itemActions(item)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty muted">{current ? 'Далі нічого немає. Додайте наступний трек.' : 'Поки порожньо. Перший трек одразу стане поточним.'}</p>
            )}
          </>
        )}
      </section>

      <aside className="side panel">
        <div className="panel-head">
          <h2>У кімнаті</h2>
          <span className="muted small">{state?.members.length ?? 0}</span>
        </div>
        <ul className="members">
          {state?.members.map((m) => (
            <li key={m.username}>
              <Avatar name={m.username} />
              <span>{m.username}</span>
              {m.role === 'owner' && (
                <span className="owner-mark" title="Власник кімнати">
                  <CrownIcon />
                </span>
              )}
              {m.plan === 'premium' && <span className="plan-badge">преміум</span>}
              {m.username === me?.username && <span className="muted small">ви</span>}
            </li>
          ))}
        </ul>

        <div className="panel-head">
          <h2>Чат</h2>
        </div>
        <div className="chat" ref={chatRef}>
          {!state?.messages.length && <p className="muted small">Повідомлень поки немає.</p>}
          {state?.messages.map((m) =>
            m.kind === 'system' ? (
              <div key={m.id} className="msg system">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={`msg${m.username === me?.username ? ' mine' : ''}`}>
                <Avatar name={m.username ?? '?'} />
                <div>
                  <b>{m.username}</b>
                  <p>{m.text}</p>
                </div>
              </div>
            ),
          )}
        </div>
        <form className="chat-form" onSubmit={sendChat}>
          <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Написати в чат" maxLength={500} />
          <button type="submit" className="icon-btn accent" disabled={!chatText.trim()} aria-label="Надіслати">
            <SendIcon />
          </button>
        </form>
      </aside>
    </div>
  );
}
