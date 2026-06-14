import { useState, useEffect } from 'react';
import { useAppState } from '../store/AppContext';
import { RUNNING_STATUSES } from '../constants';

export default function StatusBar() {
  const { state } = useAppState();
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(v => setAppVersion(v)).catch(() => {});
  }, []);
  const tasks = (state.tasks || []) as any[];
  const p = state.progress || {};
  const quotaInfos = state.quotas || [];

  // Derive live counts from task list (more responsive than progress events)
  const running = tasks.filter((t: any) => RUNNING_STATUSES.includes(t.state)).length;
  const chunkTotal = tasks.reduce((s: number, t: any) => s + (t.chunks?.length || 0), 0);
  const chunkCompleted = tasks.reduce((s: number, t: any) => s + (t.chunks || []).filter((c: any) => c.chunkState === 'done').length, 0);
  const failed = tasks.filter((t: any) => t.state === 'failed').length;
  const total = tasks.length;
  const completed = tasks.filter((t: any) => t.state === 'done').length;

  // Prefer progress events when they have higher values, fall back to computed
  const rs = Math.max(running, p.running || 0);
  const ct = Math.max(chunkTotal, p.chunkTotal || 0);
  const cc = Math.max(chunkCompleted, p.chunkCompleted || 0);
  const fs = Math.max(failed, p.failed || 0);
  const ts = Math.max(total, p.total || 0);

  const quotaLabel = (q: any) => {
    if (q.dailyLimit === -1 || q.dailyLimit === 0) {
      if (q.provider === 'paddleocr-local') return '本地';
      return '无限';
    }
    return (q.usedToday ?? q.pagesUsed ?? 0) + '/' + q.dailyLimit;
  };

  const providerDisplayName = (q: any): string => {
    const name = q.providerId || q.provider || q.label || '';
    if (name === 'mineru-cloud') return 'MinerU';
    if (name === 'paddleocr-cloud') return 'PaddleOCR';
    if (name === 'paddleocr-local') return '本地引擎';
    return name;
  };

  const quotaColor = (q: any): string => {
    const label = quotaLabel(q);
    if (label === '无限') return 'var(--green)';
    if (label === '本地') return 'var(--amber)';
    return 'var(--accent-text)';
  };

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span className="item">
          <span className="sdot g" />
          <span className="num">{rs}</span> 处理中
        </span>
        <span className="item">
          <span className="sdot a" />
          <span className="num">{cc}/{ct}</span> 分块
        </span>
        <span className="item">
          <span className="sdot r" />
          <span className="num">{fs}</span> 失败
        </span>
        <span className="item">
          ⚡ 总计 {ts} 任务 · 完成 {completed}
        </span>
      </div>
      <div className="statusbar-right">
        {quotaInfos.slice(0, 3).map((q: any, index: number) => (
          <span key={q.providerId || q.provider || index}>
            <span className="pstat">
              <span style={{
                width: 5, height: 5, borderRadius: '50%', display: 'inline-block', marginRight: 4, flexShrink: 0, verticalAlign: 'middle',
                background: q.available === false ? 'var(--red)' : 'var(--green)'
              }} />
              <span className="nm">{providerDisplayName(q)}</span>
              <span className="qt" style={{ color: quotaColor(q) }}>
                {quotaLabel(q)}
              </span>
            </span>
            {index < Math.min(quotaInfos.length, 3) - 1 && <span className="div" />}
          </span>
        ))}
        <span className="div" />
        <span>OCRFlow{appVersion ? ` v${appVersion}` : ''}</span>
      </div>
    </div>
  );
}
