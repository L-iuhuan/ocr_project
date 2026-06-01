import { useState, useCallback, useEffect, useRef } from 'react';

interface Props {
  onDrop: (paths: string[]) => void;
}

export default function DragOverlay({ onDrop }: Props) {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('📫 拖放文件以添加到任务列表');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const isFileDrag = useCallback((e: DragEvent): boolean => {
    if (e.dataTransfer?.types) {
      return e.dataTransfer.types.includes('Files');
    }
    return !!(e.dataTransfer?.files && e.dataTransfer.files.length > 0);
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setActive(true);
    setMessage('📫 拖放文件以添加到任务列表');
  }, [isFileDrag]);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  }, [isFileDrag]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    const app = document.getElementById('app');
    if (app && !app.contains(e.relatedTarget as Node)) {
      setActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setActive(false);

    const paths: string[] = [];
    if (e.dataTransfer?.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i];
        if ((f as any).path) paths.push((f as any).path);
      }
    }
    if (paths.length > 0) {
      setMessage(`✅ 已添加 ${paths.length} 个文件`);
      setActive(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setActive(false);
        setMessage('📫 拖放文件以添加到任务列表');
      }, 600);
      onDrop(paths);
    }
  }, [onDrop, isFileDrag]);

  useEffect(() => {
    const app = document.getElementById('app');
    if (!app) return;

    app.addEventListener('dragenter', handleDragEnter);
    app.addEventListener('dragover', handleDragOver);
    app.addEventListener('dragleave', handleDragLeave);
    app.addEventListener('drop', handleDrop);

    return () => {
      app.removeEventListener('dragenter', handleDragEnter);
      app.removeEventListener('dragover', handleDragOver);
      app.removeEventListener('dragleave', handleDragLeave);
      app.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop]);

  return (
    <div className={`drag-overlay${active ? ' active' : ''}`}>
      <span>{message}</span>
    </div>
  );
}
