import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'vv-theme';

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Follows the OS until the user picks a theme explicitly. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? system());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => !stored() && setTheme(system());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // storage can be unavailable (private mode); the choice just isn't remembered
      }
      return next;
    });

  return [theme, toggle];
}

/** Per-listener choice between a compact cover view and a full-width video. */
export type ViewMode = 'audio' | 'clip';
const VIEW_KEY = 'vv-view';

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'clip' ? 'clip' : 'audio';
    } catch {
      return 'audio';
    }
  });
  const set = (m: ViewMode) => {
    setMode(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {
      // storage can be unavailable (private mode); the choice just isn't remembered
    }
  };
  return [mode, set];
}
