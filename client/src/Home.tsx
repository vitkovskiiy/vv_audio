import { useEffect, useState } from 'react';
import type { RoomSummary, User } from '../../shared/types';
import { api } from './api';
import { Hero } from './Auth';
import { CloseIcon, LogoutIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';
import type { Theme } from './theme';

function ago(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return d === 1 ? 'вчера' : `${d} дн назад`;
}

interface Props {
  user: User;
  theme: Theme;
  toggleTheme: () => void;
  onLogout: () => void;
  openRoom: (id: string) => void;
}

export function Home({ user, theme, toggleTheme, onLogout, openRoom }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);

  useEffect(() => {
    api<{ rooms: RoomSummary[] }>('/api/rooms/mine')
      .then((d) => setRooms(d.rooms))
      .catch(() => setRooms([]));
  }, []);

  const create = async () => {
    try {
      const { roomId } = await api<{ roomId: string }>('/api/rooms', { method: 'POST' });
      openRoom(roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать комнату');
    }
  };

  const forget = async (id: string) => {
    setRooms((r) => r?.filter((x) => x.id !== id) ?? null);
    await api(`/api/rooms/mine/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  return (
    <div className="home">
      <div className="home-top">
        <span className="hello">
          Вы вошли как <b>{user.username}</b>
        </span>
        <button className="btn ghost small" onClick={onLogout}>
          <LogoutIcon />
          Выйти
        </button>
        <ThemeToggle theme={theme} toggle={toggleTheme} />
      </div>

      <main className="home-main">
        <Hero lead="Одна очередь и одна волна на двоих. SoundCloud, YouTube, Spotify и свои файлы играют у всех одновременно." />

        <form
          className="panel home-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) openRoom(code.trim().toUpperCase());
          }}
        >
          <button type="button" className="btn primary wide" onClick={create}>
            Создать комнату
          </button>
          <div className="or">или по коду друга</div>
          <div className="row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Код комнаты"
              maxLength={12}
              className="code-input"
              aria-label="Код комнаты"
            />
            <button type="submit" className="btn" disabled={!code.trim()}>
              Войти
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </main>

      {rooms && rooms.length > 0 && (
        <section className="my-rooms">
          <h2>Мои комнаты</h2>
          <ul>
            {rooms.map((r) => (
              <li key={r.id}>
                <button className="room-tile" onClick={() => openRoom(r.id)}>
                  {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <span className="thumb-empty">♪</span>}
                  <span className="room-tile-text">
                    <b className="code">{r.id}</b>
                    <span className="room-tile-title">{r.currentTitle ?? 'Очередь пуста'}</span>
                    <span className="muted small">
                      {r.trackCount} в очереди, {ago(r.lastVisit)}
                      {r.owner && r.owner !== user.username ? `, создал(а) ${r.owner}` : ''}
                    </span>
                  </span>
                </button>
                <button className="icon-btn subtle" onClick={() => forget(r.id)} aria-label={`Убрать комнату ${r.id} из списка`}>
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
