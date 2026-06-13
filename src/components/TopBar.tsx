import type { ViewType, PaletteId, ThemeMode } from '../types';
import PaletteSelector from './PaletteSelector';
import ThemeToggle from './ThemeToggle';

interface Props {
  activeView: ViewType;
  onViewChange: (v: ViewType) => void;
  palette: PaletteId;
  onPaletteChange: (p: PaletteId) => void;
  theme: ThemeMode;
  onThemeCycle: () => void;
  logCount?: number;
}

export default function TopBar({ activeView, onViewChange, palette, onPaletteChange, theme, onThemeCycle, logCount }: Props) {
  const isMac = window.electronAPI?.platform === 'darwin';
  const handleMinimize = () => window.electronAPI?.winMinimize?.();
  const handleMaximize = () => window.electronAPI?.winMaximize?.();
  const handleClose = () => window.electronAPI?.winClose?.();

  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="topbar-left" style={{ WebkitAppRegion: 'no-drag', paddingLeft: isMac ? 80 : 20 } as React.CSSProperties}>
        <div className="logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          OCRFlow
        </div>
        <div className="nav-tabs">
          <button className={`nav-tab${activeView === 'tasks' ? ' active' : ''}`} onClick={() => onViewChange('tasks')}>任务</button>
          <button className={`nav-tab${activeView === 'settings' ? ' active' : ''}`} onClick={() => onViewChange('settings')}>设置</button>
          <button className={`nav-tab${activeView === 'logs' ? ' active' : ''}`} onClick={() => onViewChange('logs')}>
            日志{logCount ? <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6 }}>{logCount}</span> : ''}
          </button>
        </div>
      </div>
      <div className="topbar-right" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <PaletteSelector palette={palette} onChange={onPaletteChange} />
        <ThemeToggle theme={theme} onClick={onThemeCycle} />
        {!isMac && (
          <div className="win-controls">
            <button className="win-ctrl-btn" onClick={handleMinimize} title="最小化"><span className="win-icon-min" /></button>
            <button className="win-ctrl-btn" onClick={handleMaximize} title="最大化"><span className="win-icon-max" /></button>
            <button className="win-ctrl-btn win-close" onClick={handleClose} title="关闭"><span className="win-icon-close" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
