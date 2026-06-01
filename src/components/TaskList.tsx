import TaskCard from './TaskCard';

interface Props {
  tasks: any[];
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onClear: (jobId: string) => void;
  onPause: () => void;
  onAddFiles: () => void;
}

export default function TaskList({ tasks, onCancel, onRetry, onClear, onPause, onAddFiles }: Props) {
  if (tasks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 260, margin: 'auto' }}>
        <div className="tle-icon">📦</div>
        <div className="tle-title">暂无任务</div>
        <div className="tle-hint">拖入文件到窗口或点击左侧添加文件按钮开始处理</div>
        <div style={{ marginTop: 12 }}>
          <button className="tle-btn" onClick={onAddFiles}>添加文件</button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-list">
      {tasks.map((task: any) => (
        <TaskCard key={task.jobId} task={task} onCancel={onCancel} onRetry={onRetry} onClear={onClear} onPause={onPause} />
      ))}
    </div>
  );
}
