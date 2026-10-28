import { useEffect, useRef, useState } from 'react';
import { SOURCE_LABEL, type SearchGroup, type Source } from '../../shared/types';
import { api } from './api';
import { CheckIcon, CloseIcon, PlusIcon } from './icons';

const DEBOUNCE_MS = 450;

function fmt(sec: number | null): string {
  if (!sec) return '';
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}

function isLink(s: string): boolean {
  return /^(https?:\/\/|spotify:track:)/i.test(s.trim());
}

/** One box: a pasted link is added directly, anything else searches the configured sources. */
export function Search({ addUrl }: { addUrl: (url: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [sources, setSources] = useState<Source[] | null>(null);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  useEffect(() => {
    api<{ sources: Source[] }>('/api/search/sources')
      .then((d) => setSources(d.sources))
      .catch(() => setSources([]));
  }, []);

  const q = text.trim();
  const canSearch = !!sources?.length && q.length >= 2 && !isLink(q);

  useEffect(() => {
    if (!canSearch) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const data = await api<{ groups: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(q)}`);
        if (id === reqId.current) setGroups(data.groups);
      } catch {
        if (id === reqId.current) setGroups([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [q, canSearch]);

  const add = async (url: string) => {
    setAdding(url);
    const ok = await addUrl(url);
    setAdding(null);
    if (ok) setAdded((s) => new Set(s).add(url));
    return ok;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLink(q) && (await add(q))) setText('');
  };

  const placeholder = sources?.length
    ? `Назва треку або посилання: шукаємо в ${sources.map((s) => SOURCE_LABEL[s]).join(', ')}`
    : 'Посилання на SoundCloud, YouTube або Spotify';

  return (
    <div className="search">
      <form className={`search-box${loading ? ' loading' : ''}`} onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Пошук або посилання" />
        {isLink(q) && (
          <button type="submit" className="btn primary small" disabled={adding !== null}>
            Додати
          </button>
        )}
        {q && !isLink(q) && (
          <button type="button" className="icon-btn subtle" onClick={() => setText('')} aria-label="Очистити">
            <CloseIcon />
          </button>
        )}
      </form>

      {sources?.length === 0 && q && !isLink(q) && (
        <p className="muted small">Пошук за назвою не налаштовано: додайте ключі у файл .env (див. README). Посилання працюють і без нього.</p>
      )}

      {groups.map((g) => (
        <div key={g.source} className="results">
          <div className="results-head">
            <span className={`badge ${g.source}`}>{SOURCE_LABEL[g.source]}</span>
            {g.error && <span className="error small">{g.error}</span>}
            {!g.error && !loading && g.results.length === 0 && <span className="muted small">нічого не знайшлося</span>}
          </div>
          <ul>
            {g.results.map((r) => {
              const done = added.has(r.url);
              return (
                <li key={r.url}>
                  {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <span className="thumb-empty">♪</span>}
                  <div className="result-meta">
                    <div className="result-title">{r.title}</div>
                    <div className="muted small">
                      {r.artist}
                      {r.durationSec ? `, ${fmt(r.durationSec)}` : ''}
                    </div>
                  </div>
                  <button
                    className={`icon-btn ${done ? 'done' : 'accent'}`}
                    disabled={adding !== null || done}
                    onClick={() => add(r.url)}
                    aria-label={done ? 'Додано' : `Додати «${r.title}» у чергу`}
                  >
                    {done ? <CheckIcon /> : <PlusIcon />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
