import { useEffect, useState } from 'react';
import type { User } from '../../shared/types';
import { api } from './api';
import { AuthForm, Hero } from './Auth';
import { Home } from './Home';
import { Room } from './Room';
import { useTheme } from './theme';
import { ThemeToggle } from './ThemeToggle';

function roomFromUrl(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  // undefined while we ask the server who we are
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [roomId, setRoomId] = useState(roomFromUrl);

  useEffect(() => {
    api<{ user: User }>('/api/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
    const onPop = () => setRoomId(roomFromUrl());
    const onUnauthorized = () => setUser(null);
    window.addEventListener('popstate', onPop);
    window.addEventListener('vv-unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('vv-unauthorized', onUnauthorized);
    };
  }, []);

  const openRoom = (id: string) => {
    history.pushState(null, '', id ? `?room=${id}` : '/');
    setRoomId(id);
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  if (user === undefined) return null;

  if (!user) {
    return (
      <div className="home">
        <div className="home-top">
          <ThemeToggle theme={theme} toggle={toggleTheme} />
        </div>
        <main className="home-main">
          <Hero lead="Одна черга й одна хвиля на всіх. Увійдіть або заведіть акаунт, щоб слухати разом із друзями." />
          <AuthForm invitedRoom={roomId} onAuth={setUser} />
        </main>
      </div>
    );
  }

  if (roomId) {
    return (
      <Room
        key={roomId}
        roomId={roomId}
        user={user}
        theme={theme}
        toggleTheme={toggleTheme}
        onLeave={() => openRoom('')}
        onLogout={logout}
      />
    );
  }

  return <Home user={user} theme={theme} toggleTheme={toggleTheme} onLogout={logout} openRoom={openRoom} />;
}
