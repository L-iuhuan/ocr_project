import { useState, useEffect, useCallback } from 'react';
import type { PaletteId, ThemeMode } from '../types';

const STORAGE_KEY_PALETTE = 'ocrflow-palette';
const STORAGE_KEY_THEME = 'ocrflow-theme';

function getInitialPalette(): PaletteId {
  const stored = localStorage.getItem(STORAGE_KEY_PALETTE);
  if (stored === 'ice' || stored === 'mint' || stored === 'lavender' || stored === 'amber') return stored;
  return 'lavender';
}

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY_THEME);
  if (stored === 'dark' || stored === 'light' || stored === 'auto') return stored;
  return 'auto'; // default: follow system (light/dark) + lavender
}

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'auto') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return mode;
}

function applyThemeToDOM(palette: PaletteId, mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.setAttribute('data-palette', palette);
  document.documentElement.setAttribute('data-theme', resolved);
}

export function useTheme() {
  const [palette, setPaletteState] = useState<PaletteId>(getInitialPalette);
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => { applyThemeToDOM(palette, theme); }, [palette, theme]);

  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeToDOM(palette, theme);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, palette]);

  const setPalette = useCallback((p: PaletteId) => {
    setPaletteState(p);
    localStorage.setItem(STORAGE_KEY_PALETTE, p);
  }, []);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY_THEME, t);
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark');
  }, [theme, setTheme]);

  const resolvedTheme = resolveTheme(theme);

  return { palette, setPalette, theme, setTheme, cycleTheme, resolvedTheme };
}
