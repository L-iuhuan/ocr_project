import type { ThemeMode } from '../types';

interface Props {
  theme: ThemeMode;
  onClick: () => void;
}

const THEME_ICONS: Record<ThemeMode, string> = {
  dark: '🌙',
  light: '☀️',
  auto: '🌓',
};

export default function ThemeToggle({ theme, onClick }: Props) {
  return (
    <button
      className={`theme-toggle${theme === 'auto' ? ' auto' : ''}`}
      onClick={onClick}
      title={`主题: ${theme === 'dark' ? '暗色' : theme === 'light' ? '亮色' : '跟随系统'}`}
    >
      {THEME_ICONS[theme]}
    </button>
  );
}
