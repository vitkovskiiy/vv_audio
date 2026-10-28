import { useEffect, useState } from 'react';
import type { RoomSummary, User } from '../../shared/types';
import { api, ApiError, errorText } from './api';
import { Hero } from './Auth';
import { CloseIcon, LogoutIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';
import type { Theme } from './theme';

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.round(h / 24);
  return d === 1 ? 'вчора' : `${d} дн тому`;
}

interface Props {
  user: User;
  theme: Theme;
  toggleTheme: () => void;
  onLogout: () => void;
  openRoom: (code: string) => void;
}

export function Home({ user, theme, toggleTheme, onLogout, openRoom }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [limitMessage, setLimitMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<{ rooms: RoomSummary[] }>('/api/rooms/mine')
      .then((d) => setRooms(d.rooms))
      .catch(() => setRooms([]));

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/api/rooms', { method: 'POST', idempotent: true });
      openRoom(code);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ROOM_LIMIT_EXCEEDED') setLimitMessage(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteRoom = async (r: RoomSummary) => {
    if (!confirm(`Видалити кімнату ${r.code} разом із чергою та чатом? Її не стане й в інших учасників.`)) return;
    try {
      await api(`/api/rooms/${r.code}`, { method: 'DELETE' });
      setLimitMessage('');
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const owned = rooms?.filter((r) => r.role === 'owner') ?? [];

  return (
    <div className="home">
      <div className="home-top">
        <span className="hello">
          Ви увійшли як <b>{user.username}</b>
          {user.plan === 'premium' && <span className="plan-badge">преміум</span>}
        </span>
        <button className="btn ghost small" onClick={onLogout}>
          <LogoutIcon />
          Вийти
        </button>
        <ThemeToggle theme={theme} toggle={toggleTheme} />
      </div>

      <main className="home-main">
        <Hero lead="Одна черга й одна хвиля на всіх. SoundCloud, YouTube і Spotify грають у всіх одночасно." />

        <form
          className="panel home-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) openRoom(code.trim().toUpperCase());
          }}
        >
          <button type="button" className="btn primary wide" onClick={create} disabled={busy}>
            Створити кімнату
          </button>
          <div className="or">або за кодом друга</div>
          <div className="row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Код кімнати"
              maxLength={12}
              className="code-input"
              aria-label="Код кімнати"
            />
            <button type="submit" className="btn" disabled={!code.trim()}>
              Увійти
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </main>

      {rooms && rooms.length > 0 && (
        <section className="my-rooms">
          <h2>Мої кімнати</h2>
          <ul>
            {rooms.map((r) => (
              <li key={r.code}>
                <button className="room-tile" onClick={() => openRoom(r.code)}>
                  {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <span className="thumb-empty">♪</span>}
                  <span className="room-tile-text">
                    <b className="code">{r.code}</b>
                    <span className="room-tile-title">{r.currentTitle ?? 'Нічого не грає'}</span>
                    <span className="muted small">
                      {r.trackCount} у черзі, {ago(r.lastVisit)}
                      {r.role === 'owner' ? ', ваша' : r.ownerName ? `, власник ${r.ownerName}` : ''}
                    </span>
                  </span>
                </button>
                {r.role === 'owner' && (
                  <button className="icon-btn subtle" onClick={() => deleteRoom(r)} aria-label={`Видалити кімнату ${r.code}`}>
                    <CloseIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {limitMessage && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="limit-title">
          <div className="panel overlay-card limit-card">
            <h2 id="limit-title">Ліміт кімнат</h2>
            <p className="muted">{limitMessage}</p>
            <ul className="limit-list">
              {owned.map((r) => (
                <li key={r.code}>
                  <span>
                    <b className="code">{r.code}</b>{' '}
                    <span className="muted small">
                      {r.currentTitle ?? 'нічого не грає'}, {ago(r.lastVisit)}
                    </span>
                  </span>
                  <button className="btn small ghost" onClick={() => deleteRoom(r)}>
                    Видалити
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn wide" onClick={() => setLimitMessage('')}>
              Закрити
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
