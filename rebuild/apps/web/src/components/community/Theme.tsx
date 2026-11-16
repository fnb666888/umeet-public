'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
const ThemeContext = createContext<{ theme: Theme; change: (theme: Theme) => void }>({
  theme: 'light',
  change: () => {},
});
function readTheme(): Theme {
  try {
    const value = localStorage.getItem('umeet-theme');
    if (value === 'dark' || value === 'system') return value;
  } catch {}
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTheme(readTheme());
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === 'umeet-theme' || event.key === null) setTheme(readTheme());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, ready]);
  function change(value: Theme) {
    setTheme(value);
    try {
      localStorage.setItem('umeet-theme', value);
    } catch {}
  }
  return <ThemeContext.Provider value={{ theme, change }}>{children}</ThemeContext.Provider>;
}
export function ThemeSelector() {
  const { theme, change } = useContext(ThemeContext);
  return (
    <select
      className="theme-selector"
      aria-label="主题"
      value={theme}
      onChange={(event) => change(event.target.value as Theme)}
    >
      <option value="light">浅色</option>
      <option value="dark">深色</option>
      <option value="system">跟随系统</option>
    </select>
  );
}
