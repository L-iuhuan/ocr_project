import React from 'react';

function formatElapsed(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return m + '分' + rs + '秒';
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

interface Props {
  task: any;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onClear: (jobId: string) => void;
  onPause: () => void;
}

const TaskCard = React.memo(function TaskCard({ task, onCancel, onRetry, onClear, onPause }: Props) {
  const pct = task.progress || 0;
  const isFailed = task.state === 'failed';
  const isDone = task.state === 'done';
  const isCancelled = task.state === 'cancelled';
  const isRunning = ['running', 'preprocessing', 'uploading', 'downloading', 'merging'].includes(task.state);
  const isPending = task.state === 'pending' || task.state === 'paused';
  const isQueued = isPending;

  const ft = task.fileType || '';
  const fileIconClass = ft === 'pdf' ? 'pdf' : ft === 'image' || ft === 'png' || ft === 'jpg' || ft === 'jpeg' ? 'img' : 'doc';
  const fileIcon = ft === 'pdf' ? '📄' : ft === 'image' || ft === 'png' || ft === 'jpg' || ft === 'jpeg' ? '🖼' : '📑';

  const fillClass = isFailed ? 'failed' : isDone ? 'done' : 'running';

  const failedChunks = (task.chunks || []).filter((c: any) => c.chunkState === 'failed');
  let statusText: string;
  if (isFailed) {
    statusText = failedChunks.length > 0 ? pct + '% · ' + failedChunks.length + ' 失败' : '失败';
  } else if (isDone) {
    statusText = '已完成';
  } else if (isCancelled) {
    statusText = '已取消';
  } else if (isQueued) {
    statusText = '—';
  } else {
    statusText = pct + '%';
  }

  const statusColor = isFailed ? 'var(--red)' : isDone ? 'var(--green)' : isCancelled ? 'var(--text-tertiary)' : isQueued ? 'var(--text-tertiary)' : 'var(--text-secondary)';

  let providerLabel = task.providerUsed || '';
  let providerStyle: React.CSSProperties = {};
  if (isFailed) {
    providerStyle = { background: 'var(--red-bg)', color: 'var(--red)', borderColor: 'rgba(201,122,138,0.15)' };
  } else if (isDone) {
    providerStyle = { background: 'var(--green-bg)', color: 'var(--green)', borderColor: 'rgba(107,184,154,0.15)' };
  }

  return (
    <div
      className={'task-card' + (isFailed ? ' failed' : '') + (isDone ? ' done' : '')}
      style={isQueued ? { opacity: 0.55 } : undefined}
    >
      <div className="row1">
        <div className={'file-icon ' + fileIconClass}>{fileIcon}</div>
        <div className="info">
          <div className="name" title={task.originalName}>{task.originalName}</div>
          <div className="meta">
            {task.fileSize > 0 && <span>📦 {formatSize(task.fileSize)}</span>}
            {task.pageCount > 0 && <span>📄 {task.pageCount} 页</span>}
            <span>⚡ {isQueued ? '—' : formatElapsed(task.elapsed)}</span>
          </div>
        </div>
        {providerLabel && (
          <span className="provider-tag" style={providerStyle}>{providerLabel}</span>
        )}
        <div className="actions">
          {isFailed && (
            <button className="act" title="重试" onClick={() => onRetry(task.jobId)}>↩</button>
          )}
          {isDone && (
            <button className="act" title="打开输出目录" onClick={() => window.electronAPI?.openOutputDir(task.outputDir)}>📂</button>
          )}
          {(isRunning || isPending) && (
            <button className="act" title="取消" onClick={() => onCancel(task.jobId)}>✕</button>
          )}
          {(isFailed || isDone || isCancelled) && (
            <button className="act" title="移除" onClick={() => onClear(task.jobId)}>✕</button>
          )}
          {isRunning && (
            <button className="act" title="暂停" onClick={() => onPause()}>⏸</button>
          )}
        </div>
      </div>

      <div className="prog-row">
        <div className="prog-bar">
          <div className={'fill ' + fillClass} style={{ width: (isQueued ? 0 : Math.min(pct, 100)) + '%' }} />
        </div>
        <span className="prog-text" style={{ color: statusColor }}>{statusText}</span>
      </div>

      <div className="chunks">
        {(task.chunks || []).length > 0 ? (
          (task.chunks || []).map((c: any, i: number) => {
            const cs = c.chunkState || 'pending';
            const cpStatus = cs === 'pending' ? 'queued'
              : ['uploading', 'running', 'downloading'].includes(cs) ? 'proc'
              : cs === 'merging' ? 'extract'
              : cs === 'done' ? 'done' : 'fail';
            const pg = c.pageStart && c.pageEnd ? '第' + c.pageStart + '-' + c.pageEnd + '页' : '分块' + (c.chunkSequence + 1);
            const icon = cs === 'done' ? '✅'
              : cs === 'failed' || cpStatus === 'fail' ? '❌'
              : cs === 'merging' ? '📦'
              : ['uploading', 'running', 'downloading'].includes(cs) ? '●'
              : '●';
            const hasDot = ['uploading', 'running', 'downloading'].includes(cs);
            return (
              <span key={i} className={'cp ' + cpStatus} title={pg + ': ' + cs}>
                {hasDot ? <span className="pdot" /> : null}
                {!hasDot ? icon : null}
                {' ' + pg}
              </span>
            );
          })
        ) : isDone ? (
          <span className="cp done">✅ 处理完毕</span>
        ) : isFailed ? (
          <span className="cp fail">❌ 处理失败</span>
        ) : isQueued ? (
          <span className="cp queued">● 排队中</span>
        ) : null}
      </div>
    </div>
  );
});

export default TaskCard;
