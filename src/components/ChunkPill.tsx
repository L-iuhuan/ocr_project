import type { ChunkState } from '../types';

const STATUS_MAP: Record<string, string> = {
  pending: 'queued',
  uploading: 'proc',
  running: 'proc',
  downloading: 'proc',
  merging: 'extract',
  done: 'done',
  failed: 'fail',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  uploading: '上传中',
  running: '解析中',
  downloading: '下载中',
  merging: '合并中',
  done: '已完成',
  failed: '失败',
};

interface Props {
  chunkState: ChunkState;
  chunkSequence: number;
  pageStart?: number;
  pageEnd?: number;
  errorCode?: string;
  onClick?: () => void;
}

export default function ChunkPill({ chunkState, chunkSequence, pageStart, pageEnd, errorCode, onClick }: Props) {
  const cssStatus = STATUS_MAP[chunkState] || 'queued';
  const statusLabel = STATUS_LABELS[chunkState] || chunkState;
  const label = pageStart && pageEnd ? `第${pageStart}-${pageEnd}页` : `分块${chunkSequence + 1}`;
  const isFailed = chunkState === 'failed';

  const tooltip = `${label}: ${statusLabel}${errorCode ? ' - ' + errorCode : ''}${isFailed ? ' — 点击重试' : ''}`;

  return (
    <span
      className={`cp ${cssStatus}`}
      title={tooltip}
      onClick={isFailed ? onClick : undefined}
      style={isFailed ? { cursor: 'pointer' } : undefined}
    >
      {chunkState === 'uploading' && <span className="pdot" />}
      {chunkState === 'running' && <span className="pdot" />}
      {chunkState === 'downloading' && <span className="pdot" />}
      {chunkState === 'merging' && '📦'}
      {chunkState === 'done' && '✅'}
      {chunkState === 'failed' && '❌'}
      {chunkState === 'pending' && '●'}
      {` ${label}`}
    </span>
  );
}
