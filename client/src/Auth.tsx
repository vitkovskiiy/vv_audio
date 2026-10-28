import { useState } from 'react';
import type { User } from '../../shared/types';
import { api } from './api';

export function Hero({ lead }: { lead: string }) {
  return (
    <div className="home-hero">
      <div className="orb" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h1 className="logo">
        VV
        <br />
        Audio
      </h1>
      <p className="home-lead">{lead}</p>
    </div>
  );
}

export function AuthForm({ invitedRoom, onAuth }: { invitedRoom: string; onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await api<{ user: User }>(`/api/auth/${mode}`, { body: { username, password } });
      onAuth(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося');
    } finally {
      setBusy(false);
    }
  };

  const isRegister = mode === 'register';
  return (
    <form className="panel home-form" onSubmit={submit}>
      <div className="segmented wide" role="tablist">
        <button type="button" role="tab" aria-selected={!isRegister} className={!isRegister ? 'on' : ''} onClick={() => setMode('login')}>
          Вхід
        </button>
        <button type="button" role="tab" aria-selected={isRegister} className={isRegister ? 'on' : ''} onClick={() => setMode('register')}>
          Реєстрація
        </button>
      </div>

      {invitedRoom && (
        <p className="muted small">
          Вас запросили до кімнати <b className="code">{invitedRoom}</b>. {isRegister ? 'Заведіть акаунт' : 'Увійдіть'}, і одразу потрапите
          туди.
        </p>
      )}

      <label className="field">
        <span>Логін</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          maxLength={64}
          placeholder={isRegister ? 'Так вас бачитимуть у кімнаті' : ''}
        />
      </label>
      <label className="field">
        <span>Пароль</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          maxLength={128}
          placeholder={isRegister ? 'Не менше 8 символів' : ''}
        />
      </label>
      <button type="submit" className="btn primary wide" disabled={busy || !username.trim() || !password}>
        {busy ? 'Секунду…' : isRegister ? 'Створити акаунт' : 'Увійти'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
