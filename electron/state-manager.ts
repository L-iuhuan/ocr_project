import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { Task, AppSettings, PageCountRecord, ProviderStatus } from './types';

interface PersistedState {
  version: string;
  lastSaved: string;
  tasks: Task[];
  providerStatus: ProviderStatus[];
}

const VERSION = '1.0';

let _dataDir: string | null = null;

export function getUserDataPath(): string {
  if (_dataDir) return _dataDir;

  const userDir = app.getPath('userData');
  try {
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });
    const testFile = join(userDir, '.ocrflow_write_test');
    writeFileSync(testFile, 'test', 'utf-8');
    _dataDir = userDir;
    return _dataDir;
  } catch {
    const fallback = join(app.getPath('documents'), 'OCRFlow_Data');
    try {
      if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
      writeFileSync(join(fallback, '.ocrflow_write_test'), 'test', 'utf-8');
      _dataDir = fallback;
      return _dataDir;
    } catch {
      const tmp = join(app.getPath('temp'), 'ocrflow_data');
      if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
      _dataDir = tmp;
      return _dataDir;
    }
  }
}

function safeRead<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * Atomic write: write to a temp file first, then rename.
 * Prevents file corruption on crash / disk-full during write.
 * Returns true on success, false on failure.
 */
function safeWrite(file: string, data: unknown, space?: boolean): boolean {
  try {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, space ? 2 : undefined), 'utf-8');
    // Atomic rename — on Windows, renameSync replaces existing files atomically on NTFS
    renameSync(tmp, file);
    return true;
  } catch (err: any) {
    console.error('[StateManager] safeWrite failed: ' + file + ' — ' + (err.message || err));
    try { const tmp = file + '.tmp'; if (existsSync(tmp)) { const { unlinkSync } = require('fs'); unlinkSync(tmp); } } catch {}
    return false;
  }
}

export function loadTasks(): Task[] {
  const file = join(getUserDataPath(), 'ocrflow_tasks.json');
  const raw = safeRead<PersistedState | null>(file, null);
  return raw?.tasks || [];
}

export function saveTasks(tasks: Task[], providerStatus: ProviderStatus[]): boolean {
  const file = join(getUserDataPath(), 'ocrflow_tasks.json');
  return safeWrite(file, { version: VERSION, lastSaved: new Date().toISOString(), tasks, providerStatus }, true);
}

export function loadProviderStatus(): ProviderStatus[] {
  const file = join(getUserDataPath(), 'ocrflow_tasks.json');
  const raw = safeRead<PersistedState | null>(file, null);
  return raw?.providerStatus || [];
}

export const DEFAULT_SETTINGS: AppSettings = {
    providers: {
      mineruCloud: { baseUrl: 'https://mineru.net/api/v4', token: '' },
      paddleocrCloud: { token: '' },
      paddleocrLocal: { enabled: false, port: 51987, pythonPath: 'python' }
    },
    providerPriority: ['mineru-cloud', 'paddleocr-cloud'],
    outputDir: join(app.getPath('documents'), 'OCRFlow_Output'),
    outputFormats: ['md'],
    outputFileNameTemplate: '{date}/{name}',
    concurrency: 2,
    maxChunksPerFile: 3,
    chunkSize: 20,
    theme: 'dark',
    autoStart: false,
    autoExtractZip: true,
    deleteChunkTemp: true,
    keepImages: true,
    imageOutputDir: '', // empty = follow outputDir  (default: {outputDir}/images)
    ollamaEnabled: true,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2-vision:11b',
    openaiCompatEnabled: true,
    openaiCompatType: '自定义 OpenAI 兼容',
    openaiCompatUrl: 'http://127.0.0.1:8080',
    openaiCompatModel: '',
    localServiceEnabled: false,
    localServiceType: 'MinerU local service',
    localServiceUrl: 'http://localhost:8000'
  };

export function loadSettings(): AppSettings {
  const file = join(getUserDataPath(), 'ocrflow_settings.json');
  const saved = safeRead<Partial<AppSettings>>(file, {});
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  // Guard: if providers was null/undefined in saved JSON, restore from defaults
  if (!merged.providers || typeof merged.providers !== 'object') {
    merged.providers = { ...DEFAULT_SETTINGS.providers };
  }
  return merged;
}

export function saveSettings(settings: AppSettings): boolean {
  const file = join(getUserDataPath(), 'ocrflow_settings.json');
  return safeWrite(file, settings, true);
}

export function loadPageCounts(): Record<string, Record<string, PageCountRecord>> {
  const file = join(getUserDataPath(), 'ocrflow_counters.json');
  return safeRead<Record<string, Record<string, PageCountRecord>>>(file, {});
}

export function savePageCounts(counts: Record<string, Record<string, PageCountRecord>>): boolean {
  const file = join(getUserDataPath(), 'ocrflow_counters.json');
  return safeWrite(file, counts, true);
}

export function getTempDir(): string {
  const dir = join(app.getPath('temp'), 'ocrflow_temp');
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    console.error('[StateManager] Failed to create temp dir: ' + (err.message || err));
  }
  return dir;
}

export function getOutputDir(outDir?: string): string {
  const dir = outDir || DEFAULT_SETTINGS.outputDir;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    console.error('[StateManager] Failed to create output dir: ' + (err.message || err));
  }
  return dir;
}

export function generateJobId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
