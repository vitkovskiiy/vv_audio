import { MoonIcon, SunIcon } from './icons';
import type { Theme } from './theme';

export function ThemeToggle({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  const next = theme === 'dark' ? 'светлую' : 'тёмную';
  return (
    <button className="icon-btn" onClick={toggle} title={`Включить ${next} тему`} aria-label={`Включить ${next} тему`}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
