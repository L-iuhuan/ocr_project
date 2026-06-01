import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppProvider, useAppState } from './store/AppContext';
import type { LogEntryWithId } from './store/AppContext';
import { useTheme } from './hooks/useTheme';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import DragOverlay from './components/DragOverlay';
import TaskList from './components/TaskList';
import SettingsView from './components/SettingsView';
import type { ViewType, TaskFilter } from './types';

const FILTER_CHIPS: { key: TaskFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '处理中' },
  { key: 'queued', label: '排队中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' },
  { key: 'cancelled', label: '已取消' },
];

const RUNNING_STATUSES = ['running', 'preprocessing', 'uploading', 'downloading', 'merging'];
const QUEUED_STATUSES = ['pending', 'paused'];

function isRunningStatus(s: string) { return RUNNING_STATUSES.includes(s); }
function isDoneStatus(s: string) { return s === 'done'; }
function isFailedStatus(s: string) { return s === 'failed'; }
function isQueuedStatus(s: string) { return QUEUED_STATUSES.includes(s); }
function isCancelledStatus(s: string) { return s === 'cancelled'; }

function LogsView() {
  const { state } = useAppState();
  const logs = state.logs as LogEntryWithId[];
  const ref = React.useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');

  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs.length]);

  const filtered = useMemo(() => logs.filter((e) => {
    if (levelFilter !== 'all' && e.level !== levelFilter) return false;
    if (search && !String(e.message || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [logs, levelFilter, search]);

  const levelStyle = (lvl: string): React.CSSProperties => {
    if (lvl === 'warn') return { color: 'var(--amber)', background: 'var(--amber-bg)', fontWeight: 700 };
    if (lvl === 'error') return { color: 'var(--red)', background: 'var(--red-bg)', fontWeight: 700 };
    if (lvl === 'success') return { color: 'var(--green)', background: 'var(--green-bg)', fontWeight: 700 };
    return { opacity: 0.5 };
  };
  const ts = (s: string) => { try { return new Date(s).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return s?.slice(11, 19) || ''; } };

  const levels = ['all', 'info', 'warn', 'error', 'success'];
  const levelLabels: Record<string, string> = { all: '全部', info: '信息', warn: '警告', error: '错误', success: '成功' };
  const lc: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of levels) counts[l] = l === 'all' ? logs.length : logs.filter(e => e.level === l).length;
    return counts;
  }, [logs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexShrink: 0 }}>
        <div className="search-box"><span style={{ opacity: 0.4 }}>🔍</span><input type="text" placeholder="搜索日志..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 140 }} /></div>
        <div style={{ display: 'flex', gap: 4 }}>
          {levels.map(l => (
            <button key={l} className={`filter-chip${levelFilter === l ? ' active' : ''}`} onClick={() => setLevelFilter(l)}>{levelLabels[l]}{l !== 'all' && lc[l] > 0 && <span className="count">{lc[l]}</span>}</button>
          ))}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{filtered.length} / {logs.length} 条</span>
      </div>
      <div ref={ref} style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
            {logs.length === 0 ? '暂无日志，添加文件并开始处理后这里将显示实时日志' : '没有匹配的日志'}
          </div>
        ) : (
          filtered.map((e) => (
            <div key={e.id} style={{ display: 'flex', gap: 8, padding: '2px 4px', alignItems: 'baseline', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 10, minWidth: 60, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{ts(e.timestamp)}</span>
              <span style={{ fontSize: 9, padding: '0 5px', borderRadius: 3, minWidth: 38, textAlign: 'center', flexShrink: 0, ...levelStyle(e.level) }}>{String(e.level || '').toUpperCase().slice(0, 4)}</span>
              <span style={{ color: e.level === 'warn' ? 'var(--amber)' : e.level === 'error' ? 'var(--red)' : e.level === 'success' ? 'var(--green)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.message}</span>
              {e.jobId && <span style={{ color: 'var(--text-tertiary)', fontSize: 9, flexShrink: 0, opacity: 0.5, marginLeft: 'auto' }}>{e.jobId.slice(-8)}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function loadClearedIds(): Set<string> {
  try {
    const raw = localStorage.getItem('ocrflow_cleared_ids');
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
  } catch { return new Set<string>(); }
}

function AppInner() {
  const { state, dispatch } = useAppState();
  const { palette, theme, cycleTheme, setPalette } = useTheme();

  const [activeView, setActiveView] = useState<ViewType>('tasks');
  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [paused, setPaused] = useState(false);

  // Track cleared job IDs so IPC updates don't bring them back.
  // Persisted to localStorage so cleared tasks don't reappear on restart.
  const clearedIdsRef = useRef<Set<string>>(loadClearedIds());
  const isFirstLoad = useRef(true);
  const prevStatesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.getTasks().then((t: any) => {
      const tasks = (t || []) as any[];
      // Auto-archive done tasks from previous sessions on first load
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        for (const tk of tasks) {
          if (tk.state === 'done') clearedIdsRef.current.add(tk.jobId);
        }
      }
      dispatch({ type: 'SET_TASKS', payload: tasks.filter((tk: any) => !clearedIdsRef.current.has(tk.jobId)) });
    });
    api.getProviderQuotas().then((q: any) => dispatch({ type: 'SET_QUOTAS', payload: q || [] }));
    api.getProviderStatus().then((s: any) => dispatch({ type: 'SET_PROVIDERS', payload: s || [] }));
    const u1 = api.onTasksUpdate((t: any) => {
      const tasks = (t || []) as any[];
      dispatch({ type: 'SET_TASKS', payload: tasks.filter((tk: any) => !clearedIdsRef.current.has(tk.jobId)) });
    });
    const u2 = api.onLog((l: any) => dispatch({ type: 'ADD_LOG', payload: l }));
    const u3 = api.onProgress((p: any) => dispatch({ type: 'SET_PROGRESS', payload: p }));
    const u4 = api.onQuotasUpdate((q: any) => dispatch({ type: 'SET_QUOTAS', payload: q || [] }));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // Track task state transitions → accumulate cumulative stats
  useEffect(() => {
    const tasks: any[] = state.tasks || [];
    let newDone = 0, newFailed = 0, newPages = 0, newFiles = 0;
    const current: Record<string, string> = {};
    for (const t of tasks) {
      current[t.jobId] = t.state;
      const prev = prevStatesRef.current[t.jobId];
      if (prev && prev !== t.state) {
        if (t.state === 'done' && prev !== 'done') { newDone++; newPages += t.pageCount || 0; newFiles++; }
        if (t.state === 'failed' && prev !== 'failed') { newFailed++; newPages += t.pageCount || 0; newFiles++; }
      }
    }
    prevStatesRef.current = current;
    if (newDone > 0 || newFailed > 0) {
      dispatch({ type: 'INCREMENT_CUMULATIVE', payload: { done: newDone, failed: newFailed, pages: newPages, files: newFiles } });
    }
  }, [state.tasks]);

  const handleAddFiles = useCallback(async (paths: string[]) => {
    dispatch({ type: 'ADD_LOG', payload: { timestamp: new Date().toISOString(), level: 'info', message: `正在添加 ${paths.length} 个路径...` } });
    try {
      await window.electronAPI?.addFiles(paths);
      const updated = (await window.electronAPI?.getTasks() || []) as any[];
      dispatch({ type: 'SET_TASKS', payload: updated.filter((tk: any) => !clearedIdsRef.current.has(tk.jobId)) });
      dispatch({ type: 'SET_QUOTAS', payload: await window.electronAPI?.getProviderQuotas() || [] });
    } catch (e: any) {
      dispatch({ type: 'ADD_LOG', payload: { timestamp: new Date().toISOString(), level: 'error', message: '错误: ' + e.message } });
    }
  }, []);

  const handleCancel = useCallback((jobId: string) => { window.electronAPI?.cancelTask(jobId); }, []);
  const handleRetry = useCallback((jobId: string) => { window.electronAPI?.retryTask(jobId); }, []);

  const handlePause = useCallback(() => {
    if (paused) { window.electronAPI?.resumeQueue(); setPaused(false); }
    else { window.electronAPI?.pauseQueue(); setPaused(true); }
  }, [paused]);

  // Clear done — remove from state AND backend persistent storage
  const handleClearDone = useCallback(() => {
    const tasks = state.tasks as any[] || [];
    for (const t of tasks) {
      if (t.state === 'done') {
        clearedIdsRef.current.add(t.jobId);
        window.electronAPI?.removeTask(t.jobId);
      }
    }
    saveClearedIds();
    dispatch({ type: 'SET_TASKS', payload: tasks.filter((t: any) => t.state !== 'done') });
  }, [state.tasks]);

  // Clear failed only
  const handleClearFailed = useCallback(() => {
    const tasks = state.tasks as any[] || [];
    for (const t of tasks) {
      if (t.state === 'failed') {
        clearedIdsRef.current.add(t.jobId);
        window.electronAPI?.removeTask(t.jobId);
      }
    }
    saveClearedIds();
    dispatch({ type: 'SET_TASKS', payload: tasks.filter((t: any) => t.state !== 'failed') });
  }, [state.tasks]);

  const handleClearAll = useCallback(() => {
    const tasks = state.tasks as any[] || [];
    for (const t of tasks) {
      if (!isRunningStatus(t.state) && !isQueuedStatus(t.state)) {
        clearedIdsRef.current.add(t.jobId);
        window.electronAPI?.removeTask(t.jobId);
      }
    }
    saveClearedIds();
    dispatch({ type: 'SET_TASKS', payload: tasks.filter((t: any) => isRunningStatus(t.state) || isQueuedStatus(t.state)) });
  }, [state.tasks]);

  const handleRetryFailed = useCallback(() => {
    const tasks: any[] = state.tasks || [];
    for (const t of tasks.filter((t: any) => t.state === 'failed')) window.electronAPI?.retryTask(t.jobId);
  }, [state.tasks]);

  // Clear a single task from the list AND from backend persistent storage
  const handleClearSingle = useCallback((jobId: string) => {
    clearedIdsRef.current.add(jobId);
    saveClearedIds();
    window.electronAPI?.removeTask(jobId);
    dispatch({ type: 'SET_TASKS', payload: (state.tasks as any[] || []).filter((t: any) => t.jobId !== jobId) });
  }, [state.tasks]);

  // Clear cancelled tasks only
  const handleClearCancelled = useCallback(() => {
    const tasks = state.tasks as any[] || [];
    for (const t of tasks) {
      if (t.state === 'cancelled') {
        clearedIdsRef.current.add(t.jobId);
        window.electronAPI?.removeTask(t.jobId);
      }
    }
    saveClearedIds();
    dispatch({ type: 'SET_TASKS', payload: tasks.filter((t: any) => t.state !== 'cancelled') });
  }, [state.tasks]);

  // Save cleared IDs to localStorage so they persist across app restarts
  const saveClearedIds = () => {
    try { localStorage.setItem('ocrflow_cleared_ids', JSON.stringify([...clearedIdsRef.current])); } catch {}
  };

  const openFilePicker = useCallback(() => {
    if (window.electronAPI?.selectFiles) { window.electronAPI.selectFiles().then(p => { if (p.length > 0) handleAddFiles(p); }); return; }
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.onchange = (ev: any) => { const ps: string[] = []; for (const f of ev.target?.files || []) { if (f.path) ps.push(f.path); } if (ps.length > 0) handleAddFiles(ps); };
    inp.click();
  }, [handleAddFiles]);

  const openFolderPicker = useCallback(() => {
    if (window.electronAPI?.selectFolder) { window.electronAPI.selectFolder().then(p => { if (p.length > 0) handleAddFiles(p); }); return; }
    const inp = document.createElement('input'); inp.type = 'file'; (inp as any).webkitdirectory = true;
    inp.onchange = (ev: any) => { const ps: string[] = []; for (const f of ev.target?.files || []) { if (f.path) ps.push(f.path); } if (ps.length > 0) handleAddFiles(ps); };
    inp.click();
  }, [handleAddFiles]);

  const handleStartAll = useCallback(() => { window.electronAPI?.resumeQueue(); setPaused(false); }, []);

  // ---- Memoized derived data ----
  const tasks: any[] = (state.tasks || []) as any[];
  const quotas: any[] = (state.quotas || []) as any[];
  const cumulative = state.cumulative;

  const tc = tasks.length;
  const rc = useMemo(() => tasks.filter(t => isRunningStatus(t.state)).length, [tasks]);
  const dc = useMemo(() => tasks.filter(t => isDoneStatus(t.state)).length, [tasks]);
  const fc = useMemo(() => tasks.filter(t => isFailedStatus(t.state)).length, [tasks]);
  const qc = useMemo(() => tasks.filter(t => isQueuedStatus(t.state)).length, [tasks]);
  const tPages = useMemo(() => tasks.reduce((s: number, t: any) => s + (t.pageCount || 0), 0), [tasks]);
  const logCount = (state.logs || []).length;

  const taskProviderStats = useMemo(() => tasks.reduce((acc: Record<string, { t: number; d: number; p: number }>, t: any) => {
    const k = t.providerUsed || 'unknown';
    if (!acc[k]) acc[k] = { t: 0, d: 0, p: 0 };
    acc[k].t++;
    if (t.state === 'done') acc[k].d++;
    acc[k].p += t.pageCount || 0;
    return acc;
  }, {}), [tasks]);

  const quotaMap: Record<string, any> = useMemo(() => {
    const m: Record<string, any> = {};
    for (const q of quotas) m[q.provider || q.providerId || ''] = q;
    return m;
  }, [quotas]);

  const pn = (id: string) => ({
    'mineru-cloud': 'MinerU Cloud', 'paddleocr-cloud': 'PaddleOCR',
    'paddleocr-local': '本地引擎',
  }[id] || id);

  const sidebarProviderStats = useMemo(() => Object.entries(taskProviderStats).map(([id, s]) => {
    const q = quotaMap[id];
    const qUsed = q?.usedToday ?? q?.pagesUsed;
    const qLimit = q?.dailyLimit;
    return {
      id, name: pn(id), total: s.t, done: s.d, pages: s.p,
      quotaUsed: qUsed,
      quotaLimit: qLimit === -1 || qLimit === 0 ? undefined : qLimit,
      quotaLabel: qLimit === -1 || qLimit === 0 ? '无限' : qUsed != null ? `${qUsed}/${qLimit}` : undefined,
      online: q?.available,
    };
  }), [taskProviderStats, quotaMap]);

  const filtered = useMemo(() => tasks.filter(t => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'running') return isRunningStatus(t.state);
    if (activeFilter === 'done') return isDoneStatus(t.state);
    if (activeFilter === 'failed') return isFailedStatus(t.state);
    if (activeFilter === 'queued') return isQueuedStatus(t.state);
    if (activeFilter === 'cancelled') return isCancelledStatus(t.state);
    return false;
  }).filter(t => {
    const q = searchQuery.trim().toLowerCase();
    return !q || String(t.originalName || '').toLowerCase().includes(q);
  }), [tasks, activeFilter, searchQuery]);

  const cancc = useMemo(() => tasks.filter(t => isCancelledStatus(t.state)).length, [tasks]);
  const cc: Record<TaskFilter, number> = useMemo(() => ({
    all: tc, running: rc, queued: qc, done: dc, failed: fc, cancelled: cancc
  }), [tc, rc, qc, dc, fc, cancc]);

  return (
    <div id="app" className="app">
      <TopBar activeView={activeView} onViewChange={setActiveView} palette={palette} onPaletteChange={setPalette} theme={theme} onThemeCycle={cycleTheme} logCount={logCount} />
      <div className="app-body">
        {activeView === 'tasks' && (
          <Sidebar
            activeFilter={activeFilter}
            allTasks={tasks}
            onFilterChange={setActiveFilter}
            onAddFiles={openFilePicker}
            onAddFolder={openFolderPicker}
            onStartAll={handleStartAll}
            onPause={handlePause}
            onClearDone={handleClearDone}
            onClearAll={handleClearAll}
            onClearFailed={handleClearFailed}
            onClearCancelled={handleClearCancelled}
            onRetryFailed={handleRetryFailed}
            paused={paused}
            providerStats={sidebarProviderStats}
            quotas={quotas}
            cumulative={cumulative}
          />
        )}
        <div className="main-content">
          {activeView === 'tasks' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="main-header">
                <div><h2>任务列表<span className="hint"> · {tc} 个文件 · {tPages} 页{rc > 0 ? ' · ' + rc + ' 个处理中' : ''}</span></h2></div>
                <div className="search-box"><span style={{ opacity: 0.4 }}>🔍</span><input type="text" placeholder="搜索文件..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
              </div>
              <div className="filter-bar">
                {FILTER_CHIPS.map(c => (
                  <button key={c.key} className={`filter-chip${activeFilter === c.key ? ' active' : ''}`} onClick={() => setActiveFilter(c.key)}>
                    {c.label}{cc[c.key] > 0 && <span className="count">{cc[c.key]}</span>}
                  </button>
                ))}
              </div>
              <TaskList tasks={filtered} onCancel={handleCancel} onRetry={handleRetry} onClear={handleClearSingle} onPause={handlePause} onAddFiles={openFilePicker} />
            </div>
          )}
          {activeView === 'logs' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="main-header"><h2>处理日志<span className="hint"> · {logCount} 条记录</span></h2></div>
              <LogsView />
            </div>
          )}
          {activeView === 'settings' && <SettingsView onClose={() => setActiveView('tasks')} />}
        </div>
      </div>
      <StatusBar />
      <DragOverlay onDrop={handleAddFiles} />
    </div>
  );
}

export default function App() { return <AppProvider><AppInner /></AppProvider>; }
