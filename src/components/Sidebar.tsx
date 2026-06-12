import { useState, useRef, useEffect } from 'react';
import type { TaskFilter } from '../types';

interface ProviderStat {
  id: string; name: string; total: number; done: number; pages: number;
  quotaUsed?: number; quotaLimit?: number; quotaLabel?: string; online?: boolean;
}

interface Props {
  activeFilter: TaskFilter;
  allTasks: any[];
  onFilterChange: (f: TaskFilter) => void;
  onAddFiles: () => void;
  onAddFolder?: () => void;
  onStartAll?: () => void;
  onPause?: () => void;
  onClearDone?: () => void;
  onClearAll?: () => void;
  onClearFailed?: () => void;
  onClearCancelled?: () => void;
  onRetryFailed?: () => void;
  paused?: boolean;
  providerStats?: ProviderStat[];
  quotas?: any[];
  cumulative?: import('../store/AppContext').CumulativeStats;
}

const NAV_ITEMS: { filter: TaskFilter; icon: string; label: string; cssIcon?: string }[] = [
  { filter: 'all', icon: '📋', label: '全部任务' },
  { filter: 'running', icon: '⚡', label: '运行中' },
  { filter: 'queued', icon: '⏳', label: '排队中' },
  { filter: 'done', icon: '✅', label: '已完成' },
  { filter: 'failed', icon: '❌', label: '失败' },
  { filter: 'cancelled', icon: '', label: '已取消', cssIcon: 'cancelled' },
];

const S = {
  icon: { width: 18, textAlign: 'center' as const, flexShrink: 0, fontSize: 13 },
  txt: { fontSize: 12, fontWeight: 500, lineHeight: '1.3' } as const,
  disabled: { opacity: 0.35, cursor: 'default' as const } as React.CSSProperties,
};

function ClearMenu({ onClearDone, onClearFailed, onClearCancelled, onClearAll, doneCount, failedCount, cancelledCount, onClose }: {
  onClearDone?: () => void; onClearFailed?: () => void; onClearCancelled?: () => void; onClearAll?: () => void;
  doneCount: number;
  failedCount: number;
  cancelledCount: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const item = (label: string, action?: () => void, danger = false) => (
    <div
      onClick={() => { action?.(); onClose(); }}
      style={{
        padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12,
        color: danger ? 'var(--red)' : 'var(--text-secondary)',
        whiteSpace: 'nowrap', transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'var(--red-bg)' : 'var(--glass-1)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >{label}</div>
  );

  return (
    <div ref={ref} id="clear-menu" style={{
      position: 'fixed', zIndex: 300, minWidth: 200,
      padding: 6, borderRadius: 8, background: 'var(--bg-surface)',
      border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow)',
      backdropFilter: 'blur(20px)',
    }}>
      {doneCount > 0 && item(`清除已完成 (${doneCount})`, onClearDone)}
      {failedCount > 0 && item(`清除失败 (${failedCount})`, onClearFailed, true)}
      {cancelledCount > 0 && item(`清除已取消 (${cancelledCount})`, onClearCancelled)}
      {(doneCount > 0 || failedCount > 0 || cancelledCount > 0) && item(`清除全部已完成/失败/取消 (${doneCount + failedCount + cancelledCount})`, onClearAll, true)}
    </div>
  );
}

function StatsPopup({ allTasks, quotas, cumulative }: { allTasks: any[]; quotas: any[]; cumulative?: import('../store/AppContext').CumulativeStats }) {
  const isToday = (ts?: number) => {
    if (!ts) return false;
    const d = new Date(ts);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };

  // Session stats (current task list)
  const sFiles = allTasks.length;
  const sPages = allTasks.reduce((s: number, t: any) => s + (t.pageCount || 0), 0);
  const sDone = allTasks.filter((t: any) => t.state === 'done').length;
  const sFailed = allTasks.filter((t: any) => t.state === 'failed').length;
  const sdFiles = allTasks.filter((t: any) => isToday(t.createdAt)).length;
  const sdPages = allTasks.filter((t: any) => isToday(t.createdAt)).reduce((s: number, t: any) => s + (t.pageCount || 0), 0);
  const sdDone = allTasks.filter((t: any) => t.state === 'done' && isToday(t.completedAt)).length;
  const sdFailed = allTasks.filter((t: any) => t.state === 'failed' && isToday(t.completedAt)).length;

  const row = (label: string, sessionAll: number, sessionToday: number, cumAll: number, cumToday: number) => (
    <div style={{ padding: '2px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 1 }}>
        <span>{label}</span>
        <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--accent-text)', fontWeight: 600 }}>本次 {sessionAll}</span>
      </div>
      {cumulative && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 10, color: 'var(--text-tertiary)' }}>
          <span style={{ opacity: 0.6 }}>累计{cumToday > 0 ? ' · 今日 ' + cumToday : ''}</span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{cumAll}</span>
        </div>
      )}
    </div>
  );

  const quotaMap: Record<string, any> = {};
  for (const q of quotas) quotaMap[q.provider || q.providerId || ''] = q;

  const providerPages = allTasks.reduce((acc: Record<string, { pages: number; done: number; failed: number }>, t: any) => {
    const k = t.providerUsed || 'other';
    if (!acc[k]) acc[k] = { pages: 0, done: 0, failed: 0 };
    acc[k].pages += t.pageCount || 0;
    if (t.state === 'done') acc[k].done++;
    if (t.state === 'failed') acc[k].failed++;
    return acc;
  }, {});

  const pn = (id: string) => ({
    'mineru-cloud': 'MinerU', 'paddleocr-cloud': 'PaddleOCR', 'paddleocr-local': '本地引擎',
  }[id] || id);

  return (
    <div id="stats-popup" style={{
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 320, padding: 18, borderRadius: 12,
      background: 'var(--bg-surface)', border: '1px solid var(--border-glass)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)', backdropFilter: 'blur(24px)', zIndex: 200,
      maxHeight: '80vh', overflowY: 'auto',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>📊 处理统计</div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>
        本次打开期间 · 累计跨会话持久化
      </div>
      <div style={{ height: 1, background: 'var(--border-subtle)', marginBottom: 8 }} />
      {row('文件数', sFiles, sdFiles, cumulative?.totalFiles || 0, cumulative?.todayFiles || 0)}
      {row('处理页数', sPages, sdPages, cumulative?.totalPages || 0, cumulative?.todayPages || 0)}
      {row('成功', sDone, sdDone, cumulative?.totalDone || 0, cumulative?.todayDone || 0)}
      {row('失败', sFailed, sdFailed, cumulative?.totalFailed || 0, cumulative?.todayFailed || 0)}

      {Object.keys(providerPages).length > 0 && (
        <>
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '10px 0 6px' }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4 }}>按服务商（当前会话）</div>
          {Object.entries(providerPages).map(([k, v]) => {
            const q = quotaMap[k];
            const qUsed = q?.usedToday ?? q?.pagesUsed;
            const qLimit = q?.dailyLimit;
            const label = qLimit === -1 || qLimit === 0 ? '无限' : qUsed != null ? `${qUsed}/${qLimit}` : '';
            return (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11, color: 'var(--text-secondary)' }}>
                <span>{pn(k)}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {v.pages} 页 · {v.done} 完成{v.failed > 0 ? ` · ${v.failed} 失败` : ''}
                  {label ? <span style={{ marginLeft: 6, opacity: 0.7 }}>{label}</span> : ''}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function Sidebar({
  activeFilter, allTasks, onFilterChange,
  onAddFiles, onAddFolder, onStartAll, onPause, onClearDone, onClearAll, onRetryFailed,
  onClearFailed, onClearCancelled,
  paused, providerStats, quotas, cumulative,
}: Props) {
  const [showStats, setShowStats] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const clearBtnRef = useRef<HTMLButtonElement>(null);
  const statsBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showStats) return;
    const h = (e: MouseEvent) => {
      if (statsBtnRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest('#stats-popup')) return;
      setShowStats(false);
    };
    setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => document.removeEventListener('mousedown', h);
  }, [showStats]);

  const tasks = allTasks;
  const totalAll = tasks.length;
  const totalRunning = tasks.filter((t: any) =>
    ['running', 'preprocessing', 'uploading', 'downloading', 'merging'].includes(t.state)
  ).length;
  const totalDone = tasks.filter((t: any) => t.state === 'done').length;
  const totalFailed = tasks.filter((t: any) => t.state === 'failed').length;
  const totalQueued = tasks.filter((t: any) => t.state === 'pending' || t.state === 'paused').length;
  const totalCancelled = tasks.filter((t: any) => t.state === 'cancelled').length;
  const canClear = totalDone > 0 || totalFailed > 0 || totalCancelled > 0;

  const getNavCount = (filter: TaskFilter): number => {
    switch (filter) {
      case 'all': return totalAll;
      case 'running': return totalRunning;
      case 'done': return totalDone;
      case 'failed': return totalFailed;
      case 'queued': return totalQueued;
      case 'cancelled': return totalCancelled;
      default: return 0;
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-actions">
        <button className="sd-btn secondary" onClick={onAddFiles}>
          <span style={S.icon}>📄</span><span style={S.txt}>添加文件</span>
        </button>
        <button className="sd-btn secondary" onClick={onAddFolder}>
          <span style={S.icon}>📂</span><span style={S.txt}>添加文件夹</span>
        </button>

        <button
          className="sd-btn primary"
          onClick={onStartAll}
          disabled={totalQueued === 0}
          style={totalQueued === 0 ? S.disabled : {}}
        >
          <span style={S.icon}>▶</span><span style={S.txt}>全部开始</span>
        </button>

        <button
          className="sd-btn secondary"
          onClick={onPause}
          disabled={totalRunning === 0}
          style={totalRunning === 0 ? S.disabled : (paused ? { borderColor: 'var(--amber)', color: 'var(--amber)' } : {})}
        >
          <span style={S.icon}>{paused ? '▶' : '⏸'}</span>
          <span style={S.txt}>{paused ? '继续队列' : '暂停队列'}{totalRunning > 0 ? ` (${totalRunning})` : ''}</span>
        </button>

        <button
          className="sd-btn secondary"
          onClick={onRetryFailed}
          disabled={totalFailed === 0}
          style={totalFailed === 0 ? S.disabled : {}}
        >
          <span style={S.icon}>↻</span>
          <span style={S.txt}>重试失败{totalFailed > 0 ? ` (${totalFailed})` : ''}</span>
        </button>

        <button
          ref={clearBtnRef}
          className="sd-btn secondary"
          onClick={() => setShowClear(true)}
          disabled={!canClear}
          style={!canClear ? S.disabled : {}}
        >
          <span style={S.icon}>🗑</span><span style={S.txt}>清除任务</span>
        </button>

        {showClear && clearBtnRef.current && (
          <div style={{
            position: 'fixed', zIndex: 300,
            top: clearBtnRef.current.getBoundingClientRect().top,
            left: clearBtnRef.current.getBoundingClientRect().right + 6,
          }}>
            <ClearMenu
              onClearDone={onClearDone}
              onClearAll={onClearAll}
              onClearFailed={onClearFailed}
              onClearCancelled={onClearCancelled}
              doneCount={totalDone}
              failedCount={totalFailed}
              cancelledCount={totalCancelled}
              onClose={() => setShowClear(false)}
            />
          </div>
        )}
      </div>

      <div className="sd-divider" />

      <div className="sd-nav">
        {NAV_ITEMS.map(item => {
          const count = getNavCount(item.filter);
          const isActive = activeFilter === item.filter;
          return (
            <div
              key={item.filter}
              className={`sd-nav-item${isActive ? ' active' : ''}`}
              onClick={() => onFilterChange(item.filter)}
            >
              <span style={S.icon}>
                {item.cssIcon ? <span className={`nav-icon-${item.cssIcon}`} /> : item.icon}
              </span>
              <span style={S.txt}>{item.label}</span>
              <span className={`badge${isActive ? ' active-badge' : ''}`}>{count}</span>
            </div>
          );
        })}
      </div>

      <div className="sd-spacer" />

      <div className="sd-footer">
        <div
          ref={statsBtnRef}
          className="sd-nav-item"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setShowStats(!showStats)}
        >
          <span style={S.icon}>📊</span>
          <span style={S.txt}>任务统计</span>
        </div>
      </div>

      {showStats && <StatsPopup allTasks={allTasks} quotas={quotas || []} cumulative={cumulative} />}
    </div>
  );
}
