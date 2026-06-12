import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import AdmZip from 'adm-zip';
import axios from 'axios';
import { AppSettings, Chunk, GlobalProgress, Task, ProviderType } from './types';
import { IProvider, ParsedChunkResult } from './providers/i-provider';
import { getProvider } from './providers/provider-registry';
import { incrementFailedCount, incrementPageCount } from './page-counter';
import { loadSettings, saveTasks } from './state-manager';
import { mergeChunks, writeMergedOutputs, cleanupTempFiles, collectImages, rewriteImagePaths } from './pipeline/merger';
import { validateTask } from './pipeline/validator';
import { getProviderQuotas } from './page-counter';
import { BrowserWindow } from 'electron';

type TaskCallback = (tasks: Task[]) => void;
type LogLevel = 'info' | 'warn' | 'error' | 'success';
type LogCallback = (entry: { timestamp: string; level: LogLevel; message: string; jobId?: string }) => void;
type ProgressCallback = (progress: GlobalProgress & { chunkTotal: number; chunkCompleted: number }) => void;
type WorkerOptions = { persistTasks?: boolean; settingsProvider?: () => AppSettings };

const TERMINAL_STATES = ['done', 'failed', 'cancelled'];
const RUNNING_STATES = ['preprocessing', 'uploading', 'running', 'downloading', 'merging'];
const RETRYABLE_CHUNK_STATES = ['pending', 'failed'];
const MAX_CONSECUTIVE_FAILS_BEFORE_FALLBACK = 2;

/** Detect image format from magic bytes. Returns extension with dot, or empty string. */
function detectImageFormat(buf: Buffer): string {
  if (buf.length < 4) return '';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  // GIF: 47 49 46
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return '.webp';
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp';
  return '';
}

/** Auto-degrade tiers: when a chunk fails due to size, try the next smaller tier */
function degradeChunkSize(current: number): number {
  const tiers = [200, 100, 50, 20, 10, 5, 2, 1];
  for (const t of tiers) {
    if (t < current) return t;
  }
  return 0;
}

class TaskWorker {
  private queue: Task[] = [];
  private active = 0;
  private maxConcurrency = 2;
  private paused = false;
  private providerPriority: ProviderType[] = ['mineru-cloud', 'paddleocr-cloud'];
  private onUpdate?: TaskCallback;
  private onLog?: LogCallback;
  private onProgress?: ProgressCallback;
  private persistTasks = true;
  private settingsProvider: () => AppSettings = loadSettings;
  private abortControllers = new Map<string, AbortController>();

  configure(callbacks: { onUpdate: TaskCallback; onLog: LogCallback; onProgress: ProgressCallback }, options: WorkerOptions = {}): void {
    this.onUpdate = callbacks.onUpdate;
    this.onLog = callbacks.onLog;
    this.onProgress = callbacks.onProgress;
    this.persistTasks = options.persistTasks !== false;
    this.settingsProvider = options.settingsProvider || loadSettings;
    this.emitProgress();
  }

  restoreTasks(tasks: Task[]): void {
    const restored = tasks.map(task => {
      const next = { ...task, elapsed: task.elapsed || 0 };
      if (RUNNING_STATES.includes(next.state)) {
        next.state = 'pending';
        next.progress = Math.min(next.progress || 0, 99);
      }
      next.chunks = (next.chunks || []).map(chunk => {
        if (RUNNING_STATES.includes(chunk.chunkState)) {
          return { ...chunk, chunkState: 'pending', progress: 0 };
        }
        return chunk;
      });
      return next;
    });
    this.queue = restored;
    if (restored.length > 0) {
      this.log('已恢复 ' + restored.length + ' 个历史任务', 'info');
    }
    this.emitUpdate();
    this.emitProgress();
  }

  setConcurrency(n: number): void {
    this.maxConcurrency = Math.max(1, Math.min(8, Math.round(n || 1)));
    this.processQueue();
  }

  setProviderPriority(priority: string[]): void {
    this.providerPriority = priority as ProviderType[];
  }

  getProviderPriority(): ProviderType[] {
    return this.providerPriority;
  }


  log(msg: string, level: LogLevel = 'info', jobId?: string): void {
    this.onLog?.({ timestamp: new Date().toISOString(), level, message: msg, jobId });
  }

  addTasks(tasks: Task[]): void {
    this.log('添加 ' + tasks.length + ' 个任务，队列: ' + (this.queue.length + tasks.length));
    this.queue.push(...tasks);
    this.emitUpdate();
    this.processQueue();
  }

  runTasksOnce(tasks: Task[]): Promise<Task[]> {
    const ids = new Set(tasks.map(t => t.jobId));
    return new Promise(resolve => {
      const previousOnUpdate = this.onUpdate;
      const finishIfDone = (allTasks: Task[]) => {
        previousOnUpdate?.(allTasks);
        const selected = allTasks.filter(t => ids.has(t.jobId));
        if (selected.length === ids.size && selected.every(t => TERMINAL_STATES.includes(t.state))) {
          this.onUpdate = previousOnUpdate;
          resolve(selected);
        }
      };
      this.onUpdate = finishIfDone;
      this.addTasks(tasks);
      finishIfDone(this.queue);
    });
  }

  pause(): void {
    this.paused = true;
    this.log('队列已暂停', 'warn');
    this.emitProgress();
  }

  resume(): void {
    this.paused = false;
    this.log('队列已恢复');
    this.processQueue();
  }

  cancelTask(jobId: string): void {
    const task = this.queue.find(t => t.jobId === jobId);
    if (!task || task.state === 'done' || task.state === 'cancelled') return;

    // Abort any in-flight provider requests
    const ctrl = this.abortControllers.get(jobId);
    if (ctrl) {
      ctrl.abort();
      this.abortControllers.delete(jobId);
    }

    task.state = 'cancelled';
    task.completedAt = Date.now();
    task.elapsed = task.startedAt ? task.completedAt - task.startedAt : task.elapsed || 0;
    this.log('任务已取消: ' + task.originalName, 'warn', jobId);

    // Clean up temp files for cancelled tasks (normally done in finalizeTaskOutputs)
    try { cleanupTempFiles(task); } catch (e: any) {
      console.error('[TaskWorker] Temp cleanup failed on cancel: ' + (e.message || e));
    }

    this.emitUpdate();
    this.emitProgress();
  }

  retryTask(jobId: string): void {
    const task = this.queue.find(t => t.jobId === jobId);
    if (!task || (task.state !== 'failed' && task.state !== 'cancelled')) {
      this.log('无法重试任务 (状态: ' + (task?.state || 'unknown') + ')', 'warn', jobId);
      return;
    }

    // Reset ALL chunks to pending for cancelled tasks (no partial progress to save).
    // For failed tasks, only reset the failed chunks.
    const targets = task.state === 'cancelled'
      ? task.chunks
      : (task.chunks.filter(c => c.chunkState === 'failed').length > 0
          ? task.chunks.filter(c => c.chunkState === 'failed')
          : task.chunks);

    for (const chunk of targets) {
      chunk.chunkState = 'pending';
      chunk.progress = 0;
      chunk.taskId = undefined;
      chunk.errorCode = undefined;
      chunk.errorMsg = undefined;
      chunk.retryCount = (chunk.retryCount || 0) + 1;
    }

    task.state = 'pending';
    task.retryCount++;
    task.errorCode = undefined;
    task.errorMsg = undefined;
    task.completedAt = undefined;
    task.progress = this.computeTaskProgress(task);

    this.log('重试任务 (#' + task.retryCount + '): ' + task.originalName + ', ' + targets.length + ' 个分块', 'info', jobId);
    this.emitUpdate();
    this.processQueue();
  }

  getAllTasks(): Task[] {
    return this.queue;
  }

  /** Remove a task from the queue entirely (persisted). Use for user-initiated clears. */
  removeTask(jobId: string): void {
    const idx = this.queue.findIndex(t => t.jobId === jobId);
    if (idx === -1) return;
    this.queue.splice(idx, 1);
    this.log('任务已移除: ' + jobId, 'info');
    this.emitUpdate();
    this.emitProgress();
  }

  // ---- Private ----

  private processQueue(): void {
    if (this.paused) return;

    while (this.active < this.maxConcurrency) {
      const task = this.queue.find(t => t.state === 'pending');
      if (!task) break;

      task.state = 'preprocessing';
      task.startedAt = task.startedAt || Date.now();
      this.active++;
      this.emitUpdate();

      void this.processTask(task)
        .catch(err => {
          // Ignore cancellation errors — they are expected
          if (err.code === 'CANCELLED') {
            this.log('任务已取消: ' + task.originalName, 'warn', task.jobId);
          } else {
            task.state = 'failed';
            task.errorCode = err.code || 'PROCESS_ERROR';
            task.errorMsg = err.message || '未知错误';
            this.log('任务异常: ' + task.originalName + ' - ' + task.errorMsg, 'error', task.jobId);
          }
        })
        .finally(() => {
          this.active = Math.max(0, this.active - 1);
          this.abortControllers.delete(task.jobId);
          this.emitUpdate();
          this.emitProgress();
          this.processQueue();
        });
    }
  }

  private async processTask(task: Task): Promise<void> {
    // Create AbortController for this task
    const abortController = new AbortController();
    this.abortControllers.set(task.jobId, abortController);

    // Guard: if cancelled before we started, bail out immediately
    if (this.isTaskCancelled(task)) {
      throw Object.assign(new Error('任务已取消'), { code: 'CANCELLED' });
    }

    this.log('开始处理: ' + task.originalName + ' (' + task.pageCount + '页 ' + (task.fileSize / 1024 / 1024).toFixed(1) + 'MB, 服务商: ' + (task.providerUsed || '自动选择') + ')', 'info', task.jobId);
    task.state = 'running';
    task.totalChunks = task.chunks.length;
    this.emitUpdate();

    let currentProviderType: ProviderType = (task.providerUsed as ProviderType) || 'mineru-cloud';
    let provider = getProvider(currentProviderType);
    if (!provider) {
      throw Object.assign(new Error('Provider "' + currentProviderType + '" 未注册'), { code: 'PROVIDER_NOT_FOUND' });
    }

    const chunkPages = task.chunks.map(c => (c.pageEnd && c.pageStart) ? (c.pageEnd - c.pageStart + 1) : '?').join('/');
    this.log('Provider 就绪: ' + provider.type + ', ' + task.chunks.length + ' 个分块 (页: ' + chunkPages + ')', 'info', task.jobId);

    let consecutiveFails = 0;

    for (let i = 0; i < task.chunks.length; i++) {
      // Check cancellation before each chunk
      if (abortController.signal.aborted || this.isTaskCancelled(task)) {
        throw Object.assign(new Error('任务已取消'), { code: 'CANCELLED' });
      }

      // Provider fallback: if consecutive failures exceed threshold and no chunk succeeded yet
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS_BEFORE_FALLBACK &&
          task.chunks.filter(c => c.chunkState === 'done').length === 0) {
        const currentIdx = this.providerPriority.indexOf(currentProviderType);
        if (currentIdx >= 0 && currentIdx < this.providerPriority.length - 1) {
          const nextType = this.providerPriority[currentIdx + 1];
          const nextProvider = getProvider(nextType);
          if (nextProvider) {
            const oldChunkSize = provider.getChunkSize();
            const newChunkSize = nextProvider.getChunkSize();
            this.log(
              'Provider 切换: ' + currentProviderType + ' → ' + nextType +
              ' (连续 ' + consecutiveFails + ' 个分块失败，切换至备用服务商)',
              'warn', task.jobId
            );

            // Re-split remaining chunks if new provider has smaller chunk size
            if (newChunkSize < oldChunkSize) {
              try {
                const resplitCount = await this.resplitRemainingChunks(task, i, newChunkSize);
                task.totalChunks = task.chunks.length;
                if (resplitCount > 0) {
                  this.log(
                    '已重新拆分 ' + resplitCount + ' 个分块为更小单元 (每个 ≤ ' + newChunkSize + ' 页)',
                    'info', task.jobId
                  );
                }
              } catch (splitErr: any) {
                this.log('重新拆分失败: ' + (splitErr.message || '未知错误'), 'error', task.jobId);
                // Continue anyway — chunks may still work if they're within limits
              }
            }

            currentProviderType = nextType;
            provider = nextProvider;
            task.providerUsed = nextType;
            consecutiveFails = 0;
          }
        }
      }

      if (abortController.signal.aborted || this.isTaskCancelled(task)) {
        throw Object.assign(new Error('任务已取消'), { code: 'CANCELLED' });
      }

      const chunk = task.chunks[i];
      if (!chunk) throw Object.assign(new Error('分块 ' + i + ' 数据缺失'), { code: 'CHUNK_MISSING' });
      if (!RETRYABLE_CHUNK_STATES.includes(chunk.chunkState)) continue;

      task.currentChunk = i;
      try {
        await this.processChunk(task, chunk, provider, abortController.signal);
        consecutiveFails = 0;
      } catch (err: any) {
        if (err.code === 'CANCELLED') throw err; // propagate cancellation

        // Auto-degrade: when a PDF chunk fails, try splitting it into
        // smaller pieces. This handles API size limits, timeouts on large
        // files, and other transient failures. Limited to 3 attempts.
        const currentPages = this.chunkPageCount(task, chunk);
        const degraded = degradeChunkSize(currentPages);
        const retries = chunk.retryCount || 0;
        if (
          degraded > 0 &&
          retries < 3 &&
          chunk.chunkPath &&
          chunk.chunkPath.toLowerCase().endsWith('.pdf')
        ) {
          this.log(
            '分块失败，自动降级重试 (' + (retries + 1) + '/3): ' +
            currentPages + '页 → ' + degraded + '页/块',
            'warn', task.jobId
          );
          try {
            const subChunks = await this.splitOneChunk(chunk, degraded, task);
            task.chunks.splice(i, 1, ...subChunks);
            task.totalChunks = task.chunks.length;
            for (let k = 0; k < task.chunks.length; k++) {
              task.chunks[k].chunkSequence = k;
            }
            i--;
            consecutiveFails = 0;
            task.progress = this.computeTaskProgress(task);
            this.emitUpdate();
            continue;
          } catch (splitErr: any) {
            this.log('降级拆分失败: ' + (splitErr.message || ''), 'error', task.jobId);
          }
        }

        chunk.chunkState = 'failed';
        chunk.progress = Math.max(chunk.progress || 0, 1);
        chunk.errorCode = err.code || 'CHUNK_FAILED';
        chunk.errorMsg = err.message || '未知错误';
        consecutiveFails++;
        this.log('分块 ' + (i + 1) + '/' + task.chunks.length + ' 失败: ' + chunk.errorMsg, 'error', task.jobId);
      }

      task.progress = this.computeTaskProgress(task);
      task.elapsed = task.startedAt ? Date.now() - task.startedAt : 0;
      this.emitUpdate();
      this.emitProgress();
    }

    const doneChunks = task.chunks.filter(c => c.chunkState === 'done');
    const failedChunks = task.chunks.filter(c => c.chunkState === 'failed');

    if (doneChunks.length > 0) {
      task.state = 'merging';
      this.emitUpdate();

      const validation = validateTask(task);
      if (!validation.valid) {
        this.log('验证警告: ' + validation.errors.join('; '), 'warn', task.jobId);
      }

      try {
        await this.finalizeTaskOutputs(task, failedChunks.length > 0, doneChunks);
      } catch (mergeErr: any) {
        // If merge fails (disk full, permission error, etc.), mark all done
        // chunks as failed so the task reports correctly, then re-throw.
        this.log('合并输出失败: ' + (mergeErr.message || '未知错误'), 'error', task.jobId);
        for (const c of doneChunks) {
          c.chunkState = 'failed';
          c.errorMsg = '合并失败: ' + (mergeErr.message || '');
        }
        throw mergeErr;
      }
    }

    task.completedAt = Date.now();
    task.elapsed = task.startedAt ? task.completedAt - task.startedAt : task.elapsed || 0;

    if (failedChunks.length > 0) {
      task.state = 'failed';
      task.errorCode = 'CHUNK_FAILED';
      task.errorMsg = failedChunks.length + ' 个分块失败' +
        (doneChunks.length > 0 ? '，已保存部分输出' : '');
      const failedPages = failedChunks.reduce((sum, chunk) => sum + this.chunkPageCount(task, chunk), 0);
      incrementFailedCount(task.providerUsed || 'mineru-cloud', Math.max(1, failedPages));
      this.emitQuotaUpdate();
      // Clean up temp files even when all chunks failed (no merge happened)
      if (doneChunks.length === 0) {
        try { cleanupTempFiles(task); } catch {}
      }
      this.log('任务部分失败: ' + task.originalName + ' (' + failedChunks.length + '/' + task.chunks.length + ' 分块)', 'warn', task.jobId);
      return;
    }

    task.state = 'done';
    task.progress = 100;
    incrementPageCount(task.providerUsed || 'mineru-cloud', task.pageCount);
    this.emitQuotaUpdate();
    const elapsedSec = task.elapsed ? (task.elapsed / 1000).toFixed(1) + 's' : '';
    this.log('处理完成: ' + task.originalName + (elapsedSec ? ' (' + elapsedSec + ')' : ''), 'success', task.jobId);
  }

  private async processChunk(task: Task, chunk: Chunk, provider: IProvider, signal: AbortSignal): Promise<void> {
    if (!chunk.chunkPath) throw Object.assign(new Error('分块 ' + chunk.chunkSequence + ' 路径为空'), { code: 'CHUNK_NO_PATH' });
    if (!existsSync(chunk.chunkPath)) throw Object.assign(new Error('分块文件不存在: ' + chunk.chunkPath), { code: 'CHUNK_FILE_MISSING' });

    // Pre-check: file size against provider limit (triggers auto-degrade)
    let fileSize = 0;
    try { fileSize = statSync(chunk.chunkPath).size; } catch {}
    const maxBytes = provider.limits.maxFileSizeMB * 1024 * 1024;
    if (fileSize > maxBytes) {
      throw Object.assign(
        new Error(`分块文件过大: ${(fileSize/1024/1024).toFixed(1)}MB > ${provider.limits.maxFileSizeMB}MB (${provider.type})`),
        { code: 'CHUNK_TOO_LARGE' }
      );
    }

    signal.throwIfAborted();

    chunk.chunkState = 'uploading';
    chunk.errorCode = undefined;
    chunk.errorMsg = undefined;
    this.emitUpdate();
    this.log('提交分块 ' + (chunk.chunkSequence + 1) + '/' + task.chunks.length + ': ' + this.chunkLabel(task, chunk), 'info', task.jobId);

    let taskId: string;
    try {
      taskId = await provider.submit(chunk.chunkPath, (pct: number) => {
        chunk.progress = Math.min(50, Math.max(1, pct));
        task.progress = this.computeTaskProgress(task);
        task.elapsed = task.startedAt ? Date.now() - task.startedAt : 0;
        this.emitUpdate();
      }, signal);
    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) {
        throw Object.assign(new Error('任务已取消'), { code: 'CANCELLED' });
      }
      throw Object.assign(
        new Error('提交失败 (' + provider.type + '): ' + (err.message || '无详细信息')),
        { code: 'SUBMIT_FAILED' }
      );
    }

    signal.throwIfAborted();

    chunk.taskId = taskId;
    chunk.chunkState = 'running';
    this.log('已提交分块 ' + (chunk.chunkSequence + 1) + ', task_id: ' + taskId, 'info', task.jobId);

    let pollCount = 0;
    const maxPolls = 240;
    while (pollCount < maxPolls) {
      signal.throwIfAborted();
      if (this.isTaskCancelled(task)) throw Object.assign(new Error('任务已取消'), { code: 'CANCELLED' });

      let pollResult: string;
      try {
        pollResult = await provider.poll(taskId, signal);
      } catch (err: any) {
        if (err.name === 'AbortError' || signal.aborted) {
          throw Object.assign(new Error('任务已取消'), { code: 'CANCELLED' });
        }
        throw Object.assign(
          new Error('轮询失败 (' + provider.type + ', task_id: ' + taskId + '): ' + (err.message || '无详细信息')),
          { code: 'POLL_FAILED' }
        );
      }
      if (pollResult === 'done') break;
      if (pollResult === 'failed') {
        throw Object.assign(
          new Error('API 返回任务失败 (' + provider.type + ', task_id: ' + taskId + ')'),
          { code: 'API_TASK_FAILED' }
        );
      }
      pollCount++;
      chunk.progress = Math.min(95, 50 + Math.floor((pollCount / maxPolls) * 45));
      task.progress = this.computeTaskProgress(task);
      task.elapsed = task.startedAt ? Date.now() - task.startedAt : 0;
      this.emitUpdate();
      // Progressive backoff: 1s → 2s → 3s to balance speed vs API load
      const delay = pollCount < 20 ? 1000 : pollCount < 60 ? 2000 : 3000;
      await sleep(delay);
    }
    if (pollCount >= maxPolls) {
      throw Object.assign(
        new Error('轮询超时 (' + provider.type + ', task_id: ' + taskId + ', 已等待 ' + (maxPolls * 2) + '秒)'),
        { code: 'POLL_TIMEOUT' }
      );
    }

    signal.throwIfAborted();

    chunk.chunkState = 'downloading';
    this.emitUpdate();
    this.log('下载中: ' + task.originalName + ' (分块 ' + (chunk.chunkSequence + 1) + ')', 'info', task.jobId);

    const rawDir = join(task.outputDir, '_ocrflow_tmp', task.jobId, 'raw');
    ensureDir(rawDir);
    let result: ParsedChunkResult;
    try {
      result = await provider.download(taskId, rawDir, signal);
    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) {
        throw Object.assign(new Error('任务已取消'), { code: 'CANCELLED' });
      }
      throw Object.assign(
        new Error('下载失败 (' + provider.type + ', task_id: ' + taskId + '): ' + (err.message || '无详细信息')),
        { code: 'DOWNLOAD_FAILED' }
      );
    }

    chunk.chunkState = 'merging';
    this.emitUpdate();
    await this.materializeChunkResult(task, chunk, result);

    chunk.chunkState = 'done';
    chunk.progress = 100;
    this.log('分块 ' + (chunk.chunkSequence + 1) + ' 完成', 'success', task.jobId);
  }

  private async materializeChunkResult(task: Task, chunk: Chunk, result: ParsedChunkResult): Promise<void> {
    const chunkDir = join(task.outputDir, '_ocrflow_tmp', task.jobId, 'chunk_' + (chunk.chunkSequence + 1));
    ensureDir(chunkDir);

    if (result.markdown) {
      const mdPath = join(chunkDir, 'result.md');
      writeFileSync(mdPath, result.markdown, 'utf-8');
      chunk.resultUrl = mdPath;
    }

    if (result.json) {
      writeFileSync(join(chunkDir, 'result.json'), JSON.stringify(result.json, null, 2), 'utf-8');
    }

    // Save images from provider result (base64 data URLs or raw binary).
    // Preserve directory structure from image name (e.g. "imgs/fig1.png" →
    // "chunkDir/imgs/fig1.png") so markdown references stay valid.
    if (result.images && typeof result.images === 'object') {
      for (const [name, data] of Object.entries(result.images)) {
        try {
          let buffer: Buffer;
          if (typeof data === 'string') {
            const clean = data.trim();
            // PaddleOCR may return image URLs instead of base64 data
            if (clean.startsWith('http://') || clean.startsWith('https://')) {
              this.log('下载远程图片: ' + String(name), 'info', task.jobId);
              try {
                const resp = await axios.get(clean, { responseType: 'arraybuffer', timeout: 30000 });
                buffer = Buffer.from(resp.data);
              } catch (dlErr: any) {
                this.log('远程图片下载失败: ' + String(name) + ' — ' + (dlErr.message || dlErr), 'warn', task.jobId);
                continue; // skip this image
              }
            } else if (clean.startsWith('data:')) {
              const b64 = clean.split(',')[1] || clean;
              buffer = Buffer.from(b64.replace(/\s/g, ''), 'base64');
            } else {
              buffer = Buffer.from(clean.replace(/\s/g, ''), 'base64');
            }
          } else if (Buffer.isBuffer(data)) {
            buffer = data;
          } else if (typeof data === 'object' && data !== null && 'buffer' in (data as any) && ArrayBuffer.isView(data)) {
            buffer = Buffer.from(data);
          } else {
            // Unknown format — try JSON serialization then base64
            const str = typeof data === 'object' ? JSON.stringify(data) : String(data);
            buffer = Buffer.from(str.replace(/\s/g, ''), 'base64');
          }

          // Auto-detect real image format from magic bytes, correct extension
          const detectedExt = detectImageFormat(buffer);
          const originalName = String(name).replace(/[<>:"|?*]/g, '_').replace(/\.\./g, '_').replace(/^[/\\]+/, '');
          const imgPath = detectedExt
            ? join(chunkDir, originalName.replace(/\.[^.]+$/, '') + detectedExt)
            : join(chunkDir, originalName);
          ensureDir(dirname(imgPath));
          writeFileSync(imgPath, buffer);

          // If we corrected the extension, the markdown references the old name.
          // Store a mapping note for later collection.
          if (detectedExt && imgPath !== join(chunkDir, originalName)) {
            const oldPath = join(chunkDir, originalName);
            try { writeFileSync(oldPath, buffer); } catch {} // save under original name too as fallback
          }
        } catch (e: any) {
          this.log('图片保存失败: ' + (name || '?') + ' — ' + (e.message || e), 'warn', task.jobId);
        }
      }
    }

    const rawPath = result.rawPath;
    if (!rawPath || !existsSync(rawPath)) return;

    const lower = rawPath.toLowerCase();
    if (lower.endsWith('.zip')) {
      const zip = new AdmZip(rawPath);
      zip.extractAllTo(chunkDir, true);
      const mdPath = findFirstFile(chunkDir, /\.md$/i);
      if (mdPath) {
        chunk.resultUrl = mdPath;
        this.log('ZIP 已解压: 分块 ' + (chunk.chunkSequence + 1), 'info', task.jobId);
      } else {
        this.log('ZIP 中无 Markdown: 分块 ' + (chunk.chunkSequence + 1), 'warn', task.jobId);
      }
      return;
    }

    if (lower.endsWith('.md')) {
      // Only use rawPath as resultUrl if we haven't already saved parsed markdown.
      // When result.markdown exists (Agent mode), chunkDir/result.md was already
      // written and set as resultUrl — overwriting would point mergeChunks at a
      // different directory than collectImages, breaking image path rewriting.
      if (!result.markdown) {
        chunk.resultUrl = rawPath;
      }
    }
  }

  /**
   * When switching providers with a smaller chunk size, further split remaining
   * chunks so each sub-chunk respects the new provider's page limit.
   * Returns the number of chunks that were split.
   */
  private async resplitRemainingChunks(task: Task, startIdx: number, maxPages: number): Promise<number> {
    const { PDFDocument } = await import('pdf-lib');
    const newChunks: Chunk[] = [];
    let splitCount = 0;

    for (let j = 0; j < task.chunks.length; j++) {
      const chunk = task.chunks[j];

      // Keep chunks before startIdx untouched
      if (j < startIdx) {
        newChunks.push(chunk);
        continue;
      }

      // Keep non-retryable chunks (already done)
      if (!RETRYABLE_CHUNK_STATES.includes(chunk.chunkState)) {
        newChunks.push(chunk);
        continue;
      }

      const pageCount = this.chunkPageCount(task, chunk);
      if (pageCount <= maxPages || !chunk.chunkPath || !existsSync(chunk.chunkPath)) {
        newChunks.push(chunk);
        continue;
      }

      // Further split this chunk into smaller pieces
      try {
        const ext = chunk.chunkPath.toLowerCase();
        // Only PDF files can be re-split; other types keep as-is
        if (!ext.endsWith('.pdf')) {
          newChunks.push(chunk);
          continue;
        }

        const buffer = readFileSync(chunk.chunkPath);
        const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const totalPages = srcDoc.getPageCount();
        const subChunkCount = Math.ceil(totalPages / maxPages);

        for (let s = 0; s < subChunkCount; s++) {
          const start = s * maxPages;
          const end = Math.min(start + maxPages, totalPages);
          const subDoc = await PDFDocument.create();
          const indices = srcDoc.getPageIndices().slice(start, end);
          const pages = await subDoc.copyPages(srcDoc, indices);
          for (const page of pages) subDoc.addPage(page);

          const subPath = chunk.chunkPath.replace(/\.pdf$/i, `_sub${s}.pdf`);
          writeFileSync(subPath, await subDoc.save());

          const pageStart = (chunk.pageStart || 1) + start;
          const pageEnd = (chunk.pageStart || 1) + end - 1;

          newChunks.push({
            chunkSequence: 0, // will be renumbered below
            chunkPath: subPath,
            pageStart,
            pageEnd,
            chunkState: 'pending' as const,
            progress: 0,
            retryCount: 0,
          });
        }
        splitCount++;
      } catch (rsErr: any) {
        console.warn('[TaskWorker] Re-split failed for chunk, keeping original:', rsErr.message || rsErr);
        newChunks.push(chunk);
      }
    }

    // Renumber all chunk sequences sequentially
    for (let k = 0; k < newChunks.length; k++) {
      newChunks[k].chunkSequence = k;
    }

    task.chunks = newChunks;
    // Keep currentChunk in sync — point to the first sub-chunk of the
    // chunk that was at startIdx (now at position startIdx in newChunks)
    task.currentChunk = startIdx;
    return splitCount;
  }

  private async finalizeTaskOutputs(task: Task, partial: boolean, doneChunks: Chunk[]): Promise<void> {
    ensureDir(task.outputDir);

    const settings = this.settingsProvider();

    // Image output dir: default follows outputDir/images/.
    // If user set it to the same as outputDir, auto-append /images.
    const customDir = settings.imageOutputDir?.trim();
    let imageOutputDir: string;
    if (!customDir) {
      imageOutputDir = join(task.outputDir, 'images');
    } else if (customDir === task.outputDir || customDir === task.outputDir.replace(/[/\\]$/, '')) {
      imageOutputDir = join(task.outputDir, 'images');
    } else {
      imageOutputDir = customDir;
    }
    ensureDir(imageOutputDir);

    // Only collect + rewrite images if keepImages is enabled
    let finalMarkdown: string;
    if (settings.keepImages !== false) {
      const imageMappings = collectImages(task, doneChunks, imageOutputDir);
      if (imageMappings.size > 0) {
        this.log('收集到 ' + imageMappings.size + ' 个映射的图片文件', 'info', task.jobId);
      }
      const mergedMarkdown = mergeChunks(task, doneChunks);
      finalMarkdown = rewriteImagePaths(mergedMarkdown, imageMappings, imageOutputDir);
    } else {
      finalMarkdown = mergeChunks(task, doneChunks);
    }

    const written = await writeMergedOutputs(
      task, finalMarkdown, partial,
      settings.outputFileNameTemplate || undefined,
      imageOutputDir
    );

    // Only cleanup if deleteChunkTemp is enabled (default: true)
    if (settings.deleteChunkTemp !== false) {
      cleanupTempFiles(task);
    }
    this.log('输出文件: ' + written.map(p => basename(p)).join(', '), 'success', task.jobId);
  }

  private computeTaskProgress(task: Task): number {
    if (!task.chunks.length) return task.progress || 0;
    const total = task.chunks.reduce((sum, chunk) => sum + Math.max(0, Math.min(100, chunk.progress || 0)), 0);
    return Math.round(total / task.chunks.length);
  }

  private isTaskCancelled(task: Task): boolean {
    return task.state === 'cancelled';
  }

  private chunkPageCount(task: Task, chunk: Chunk): number {
    if (chunk.pageStart && chunk.pageEnd) return Math.max(1, chunk.pageEnd - chunk.pageStart + 1);
    return Math.max(1, Math.round(task.pageCount / Math.max(1, task.chunks.length)));
  }

  private chunkLabel(task: Task, chunk: Chunk): string {
    if (chunk.pageStart && chunk.pageEnd) return '第' + chunk.pageStart + '-' + chunk.pageEnd + '页';
    return task.originalName + ' #' + (chunk.chunkSequence + 1);
  }

  /**
   * Split a single chunk into smaller sub-chunks at the given max pages.
   * Used by the auto-degrade mechanism when a chunk fails due to size limits.
   */
  private async splitOneChunk(chunk: Chunk, maxPages: number, task: Task): Promise<Chunk[]> {
    const { PDFDocument } = await import('pdf-lib');
    const buffer = readFileSync(chunk.chunkPath);
    const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    const subCount = Math.ceil(totalPages / maxPages);
    if (subCount <= 1) return [chunk];

    const subChunks: Chunk[] = [];
    for (let s = 0; s < subCount; s++) {
      const start = s * maxPages;
      const end = Math.min(start + maxPages, totalPages);
      const subDoc = await PDFDocument.create();
      const indices = srcDoc.getPageIndices().slice(start, end);
      const pages = await subDoc.copyPages(srcDoc, indices);
      for (const page of pages) subDoc.addPage(page);

      const subPath = chunk.chunkPath.replace(/\.pdf$/i, `_d${s}.pdf`);
      writeFileSync(subPath, await subDoc.save());

      const pageStart = (chunk.pageStart || 1) + start;
      const pageEnd = (chunk.pageStart || 1) + end - 1;

      subChunks.push({
        chunkSequence: 0,
        chunkPath: subPath,
        pageStart,
        pageEnd,
        chunkState: 'pending' as const,
        progress: 0,
        retryCount: (chunk.retryCount || 0) + 1,
      });
    }
    return subChunks;
  }

  private emitUpdate(): void {
    if (this.persistTasks) {
      const ok = saveTasks(this.queue, []);
      if (!ok && this.onLog) {
        // Log a warning if persistence fails (e.g. disk full)
        this.log('任务状态保存失败（磁盘可能已满）', 'warn');
      }
    }
    this.onUpdate?.(this.queue);
  }

  private emitQuotaUpdate(): void {
    try {
      const quotas = getProviderQuotas();
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('quotas-update', quotas));
    } catch { /* IPC may not be ready during startup — window may be null */ }
  }

  private emitProgress(): void {
    if (!this.onProgress) return;
    const t = this.queue.length;
    const done = this.queue.filter(x => x.state === 'done').length;
    const failed = this.queue.filter(x => x.state === 'failed').length;
    const running = this.queue.filter(x => RUNNING_STATES.includes(x.state)).length;
    const pending = this.queue.filter(x => x.state === 'pending').length;
    const chunkTotal = this.queue.reduce((sum, task) => sum + task.chunks.length, 0);
    const chunkCompleted = this.queue.reduce((sum, task) => sum + task.chunks.filter(chunk => chunk.chunkState === 'done').length, 0);

    this.onProgress({
      total: t,
      completed: done,
      failed,
      running,
      pending,
      chunkTotal,
      chunkCompleted,
      pct: t > 0 ? Math.round((done + failed) / t * 100) : 0
    });
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findFirstFile(dir: string, pattern: RegExp): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const nested = findFirstFile(fullPath, pattern);
      if (nested) return nested;
    } else if (pattern.test(entry)) {
      return fullPath;
    }
  }
  return undefined;
}

export const taskWorker = new TaskWorker();
