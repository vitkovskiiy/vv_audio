import { MoonIcon, SunIcon } from './icons';
import type { Theme } from './theme';

export function ThemeToggle({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  const next = theme === 'dark' ? 'світлу' : 'темну';
  return (
    <button className="icon-btn" onClick={toggle} title={`Увімкнути ${next} тему`} aria-label={`Увімкнути ${next} тему`}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
