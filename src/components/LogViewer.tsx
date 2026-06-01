import { useAppState } from '../store/AppContext';
import { useEffect, useRef } from 'react';

const LEVEL_CLASS: Record<string, string> = {
  info: '',
  warn: 'log-warn',
  error: 'log-error',
  success: 'log-success',
};

const LEVEL_LABELS: Record<string, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  success: 'OK',
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts?.slice(11, 19) || '';
  }
}

/** Full-page standalone log panel — no conditional rendering */
export function LogPanel() {
  const { state } = useAppState();
  const logs = (state.logs || []) as any[];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, padding: '4px 0' }}>
        {logs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            暂无日志，添加文件开始处理后这里将显示实时日志
          </div>
        ) : (
          logs.map((entry: any, i: number) => (
            <div
              key={i}
              className={`log-entry ${LEVEL_CLASS[entry.level] || ''}`}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 14px', whiteSpace: 'nowrap' }}
            >
              <span style={{ color: 'var(--text-tertiary)', fontSize: 10, fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 58 }}>
                {formatTime(entry.timestamp)}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, flexShrink: 0, minWidth: 36, padding: '0 4px',
                borderRadius: 3, textAlign: 'center',
                ...(entry.level === 'warn' ? { color: 'var(--amber)', background: 'var(--amber-bg)', opacity: 1 } :
                    entry.level === 'error' ? { color: 'var(--red)', background: 'var(--red-bg)', opacity: 1 } :
                    entry.level === 'success' ? { color: 'var(--green)', background: 'var(--green-bg)', opacity: 1 } :
                    { opacity: 0.6 })
              }}>
                {LEVEL_LABELS[entry.level] || String(entry.level || '').toUpperCase()}
              </span>
              <span style={{
                color: entry.level === 'warn' ? 'var(--amber)' :
                      entry.level === 'error' ? 'var(--red)' :
                      entry.level === 'success' ? 'var(--green)' : 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis'
              }}>
                {entry.message}
              </span>
              {entry.jobId && (
                <span style={{ color: 'var(--text-tertiary)', fontSize: 9, flexShrink: 0, opacity: 0.5 }}>
                  {entry.jobId.slice(-8)}
                </span>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
