import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync, rmSync, readdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { Task, Chunk } from '../types';

// ===== Types =====

export interface WorkspaceChunkEntry {
  sequence: number;
  parentSequence?: number;
  pageStart?: number;
  pageEnd?: number;
  chunkPath: string;
  state: 'pending' | 'done' | 'failed';
  provider?: string;
  remoteTaskId?: string;
  resultMd?: string;
  resultJson?: string;
  errorCode?: string;
  errorMsg?: string;
  retryCount: number;
}

export interface WorkspaceManifest {
  version: 1;
  jobId: string;
  sourcePath: string;
  originalName: string;
  fileType: string;
  pageCount: number;
  outputDir: string;
  providerPriority: string[];
  createdAt: number;
  updatedAt: number;
  partialOutputs: string[];
  chunks: WorkspaceChunkEntry[];
}

// ===== Path resolution =====

export function resolveWorkspaceDir(jobId: string, outputDir: string): string {
  return join(outputDir, '_ocrflow_tmp', jobId);
}

export function resolveChunksDir(jobId: string, outputDir: string): string {
  return join(resolveWorkspaceDir(jobId, outputDir), 'chunks');
}

export function resolveResultsDir(jobId: string, outputDir: string): string {
  return join(resolveWorkspaceDir(jobId, outputDir), 'results');
}

export function resolveChunkResultDir(jobId: string, outputDir: string, seq: number): string {
  return join(resolveResultsDir(jobId, outputDir), `chunk_${seq}`);
}

export function resolveManifestPath(jobId: string, outputDir: string): string {
  return join(resolveWorkspaceDir(jobId, outputDir), 'manifest.json');
}

// ===== Atomic write helper =====

function safeWrite<T>(file: string, data: T): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  // On NTFS, renameSync replaces the target atomically
  renameSync(tmp, file);
}

// ===== Manifest CRUD =====

export function writeManifest(jobId: string, outputDir: string, task: Task, partialOutputs: string[] = []): void {
  const path = resolveManifestPath(jobId, outputDir);
  const existing = readManifest(jobId, outputDir);
  const manifest: WorkspaceManifest = {
    version: 1,
    jobId,
    sourcePath: task.sourcePaths?.[0] || '',
    originalName: task.originalName,
    fileType: task.fileType,
    pageCount: task.pageCount || 0,
    outputDir,
    providerPriority: task.providerUsed ? [task.providerUsed] : [],
    createdAt: existing?.createdAt || task.createdAt || Date.now(),
    updatedAt: Date.now(),
    partialOutputs: partialOutputs.length > 0 ? partialOutputs : (existing?.partialOutputs || []),
    chunks: task.chunks.map(c => ({
      sequence: c.chunkSequence,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      chunkPath: c.chunkPath,
      state: c.chunkState as 'pending' | 'done' | 'failed',
      provider: task.providerUsed,
      remoteTaskId: c.taskId,
      resultMd: c.chunkState === 'done' ? c.resultUrl : undefined,
      resultJson: undefined,
      errorCode: c.errorCode,
      errorMsg: c.errorMsg,
      retryCount: c.retryCount || 0,
    })),
  };
  safeWrite(path, manifest);
}

export function readManifest(jobId: string, outputDir: string): WorkspaceManifest | null {
  const path = resolveManifestPath(jobId, outputDir);
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceManifest;
  } catch {
    return null;
  }
}

export function recordPartialOutputs(jobId: string, outputDir: string, files: string[]): void {
  const manifest = readManifest(jobId, outputDir);
  if (!manifest) return;
  manifest.partialOutputs = files;
  safeWrite(resolveManifestPath(jobId, outputDir), manifest);
}

// ===== Manifest ↔ in-memory Task sync =====

export function syncManifestToTask(task: Task, outputDir: string): void {
  const manifest = readManifest(task.jobId, outputDir);
  if (!manifest) return;

  task.sourcePaths = manifest.sourcePath ? [manifest.sourcePath] : task.sourcePaths;
  task.chunks = manifest.chunks.map((mch, i) => {
    const existing = task.chunks.find(c => c.chunkSequence === mch.sequence);
    const chunk: Chunk = {
      chunkSequence: mch.sequence,
      chunkPath: mch.chunkPath,
      pageStart: mch.pageStart,
      pageEnd: mch.pageEnd,
      taskId: mch.remoteTaskId,
      chunkState: mch.state,
      resultUrl: mch.resultMd,
      progress: mch.state === 'done' ? 100 : 0,
      errorCode: mch.errorCode,
      errorMsg: mch.errorMsg,
      retryCount: mch.retryCount,
    };
    return chunk;
  });
  task.totalChunks = task.chunks.length;
  task.progress = task.chunks.length > 0
    ? Math.round(task.chunks.reduce((s, c) => s + Math.max(0, c.progress || 0), 0) / task.chunks.length)
    : 0;
}

// ===== Workspace cleanup =====

export function deleteWorkspace(jobId: string, outputDir: string): void {
  const dir = resolveWorkspaceDir(jobId, outputDir);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

export function cleanupStaleWorkspaces(outputDir: string, activeJobIds: Set<string>): void {
  const tmpParent = join(outputDir, '_ocrflow_tmp');
  if (!existsSync(tmpParent)) return;

  for (const entry of readdirSync(tmpParent)) {
    if (entry.startsWith('.') || entry === 'desktop.ini' || entry === 'Thumbs.db') continue;
    const full = join(tmpParent, entry);
    try {
      const st = require('fs').statSync(full);
      if (st.isDirectory() && !activeJobIds.has(entry)) {
        rmSync(full, { recursive: true, force: true });
      }
    } catch {}
  }

  // Remove parent if empty
  try {
    const remaining = readdirSync(tmpParent).filter(e => e !== '.' && e !== '..' && !e.startsWith('.') && e !== 'desktop.ini' && e !== 'Thumbs.db');
    if (remaining.length === 0) rmSync(tmpParent, { force: true });
  } catch {}
}
