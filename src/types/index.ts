// =============================================================================
// OCRFlow Type Definitions — unified with electron/types.ts
// =============================================================================

// ---- Re-export backend-aligned core types ----

export type ProviderType = 'mineru-cloud' | 'paddleocr-cloud' | 'paddleocr-local';
export type ProviderId = ProviderType | 'ollama' | 'openai-compat' | 'local-service';

export type TaskState =
  | 'pending' | 'preprocessing' | 'uploading' | 'running'
  | 'downloading' | 'merging' | 'done' | 'failed' | 'cancelled' | 'paused';

export type ChunkState = 'pending' | 'uploading' | 'running' | 'downloading' | 'merging' | 'done' | 'failed';
export type OutputFormat = 'md' | 'json' | 'html' | 'docx';

// ---- Chunk (matches electron/types.ts) ----

export interface Chunk {
  chunkSequence: number;
  chunkPath: string;
  pageStart?: number;
  pageEnd?: number;
  taskId?: string;
  chunkState: ChunkState;
  resultUrl?: string;
  progress: number;             // 0-100
  errorCode?: string;
  errorMsg?: string;
  retryCount?: number;
}

// ---- Task (matches electron/types.ts) ----

export interface Task {
  jobId: string;
  originalName: string;
  sourcePaths?: string[];
  fileType: string;
  fileSize: number;             // bytes
  pageCount: number;
  outputFormats?: OutputFormat[];
  outputDir?: string;
  state: TaskState;
  progress: number;
  currentChunk?: number;
  totalChunks?: number;
  chunks: Chunk[];
  errorCode?: string;
  errorMsg?: string;
  retryCount?: number;
  providerUsed?: string;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  elapsed: number;              // ms
}

// ---- UI-only types ----

export type PaletteId = 'ice' | 'mint' | 'lavender' | 'amber';
export type ThemeMode = 'dark' | 'light' | 'auto';
export type ViewType = 'tasks' | 'settings' | 'logs';
export type TaskFilter = 'all' | 'running' | 'done' | 'failed' | 'queued' | 'cancelled';

// ---- Settings (matches electron AppSettings) ----

export interface ProviderEntry {
  enabled: boolean;
  baseUrl?: string;
  token?: string;
  model?: string;
  port?: number;
  pythonPath?: string;
  type?: string;
  extraOptions?: Record<string, boolean>;
}

export interface Settings {
  providers: {
    mineruCloud: { baseUrl: string; token: string };
    paddleocrCloud: { token: string };
    paddleocrLocal: { enabled: boolean; port: number; pythonPath: string };
  };
  providerPriority: string[];
  outputDir: string;
  outputFormats: string[];
  outputFileNameTemplate: string;
  concurrency: number;
  maxChunksPerFile: number;
  chunkSize: number;
  theme: ThemeMode;
  autoStart: boolean;
  autoExtractZip: boolean;
  deleteChunkTemp: boolean;
  keepImages: boolean;
  imageOutputDir: string;
  ollamaEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  openaiCompatEnabled: boolean;
  openaiCompatType: string;
  openaiCompatUrl: string;
  openaiCompatModel: string;
  localServiceEnabled: boolean;
  localServiceType: string;
  localServiceUrl: string;
  extendedProviders?: Record<string, ProviderEntry>;
}

// ---- Provider Status ----

export interface ProviderStatus {
  type: ProviderType;
  available: boolean;
  quotaExhausted: boolean;
  lastError?: string;
  lastChecked: string;
}

export interface ProviderStatusExtended {
  id: ProviderId;
  name: string;
  online: boolean;
  enabled?: boolean;
  pagesUsedToday?: number;
  dailyLimit?: number;
  quotaLabel: string;
}

// ---- Log & Progress ----

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'debug';
  jobId?: string;
  message: string;
}

export interface ProgressState {
  pct: number;
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  chunkTotal?: number;
  chunkCompleted?: number;
}

// ---- Quota ----

export interface QuotaInfo {
  provider: ProviderType;
  dailyLimit: number;
  usedToday: number;
  failedToday: number;
  remaining: number;
  percentUsed: number;
}

// ---- App State (for useReducer) ----

export interface AppState {
  tasks: Task[];
  logs: LogEntry[];
  quotas: QuotaInfo[];
  providerStatus: ProviderStatus[];
  settings: Partial<Settings>;
  progress: ProgressState;
}

// ---- Electron IPC ----

export interface ElectronAPI {
  platform: string;
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;
  addFiles(paths: string[]): Promise<void>;
  selectFiles(): Promise<string[]>;
  selectFolder(): Promise<string[]>;
  getTasks(): Promise<Task[]>;
  pauseQueue(): void;
  resumeQueue(): void;
  cancelTask(jobId: string): void;
  retryTask(jobId: string): void;
  removeTask(jobId: string): void;
  selectOutputDir(): Promise<string>;
  openOutputDir(dirPath?: string): Promise<void>;
  saveSettings(settings: unknown): Promise<void>;
  loadSettings(): Promise<unknown>;
  getDefaultSettings(): Promise<unknown>;
  getProviderStatus(): Promise<unknown[]>;
  testProviderConnection(type: string, creds: unknown): Promise<{ ok: boolean; message: string }>;
  setProviderPriority(providers: string[]): void;
  getProviderQuotas(): Promise<unknown[]>;
  getAppVersion(): Promise<string>;
  getMcpConfig(): Promise<string>;
  onTasksUpdate(cb: (tasks: unknown[]) => void): () => void;
  onLog(cb: (log: unknown) => void): () => void;
  onProgress(cb: (progress: unknown) => void): () => void;
  onQuotasUpdate(cb: (quotas: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
