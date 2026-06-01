// ========== Providers ==========

export type ProviderType = 'mineru-cloud' | 'paddleocr-cloud' | 'paddleocr-local';

// Extended provider IDs for settings panel (UI-only; backend only uses the 3 above)
export type ProviderId = ProviderType | 'ollama' | 'openai-compat' | 'local-service';

// ========== Task & Chunk States ==========

export type TaskState =
  | 'pending' | 'preprocessing' | 'uploading' | 'running'
  | 'downloading' | 'merging' | 'done' | 'failed' | 'cancelled' | 'paused';

export type ChunkState = 'pending' | 'uploading' | 'running' | 'downloading' | 'merging' | 'done' | 'failed';

export type FileType = 'pdf' | 'pptx' | 'image' | 'docx' | 'xlsx' | 'doc' | 'ppt' | 'txt' | 'wps' | 'ofd';

export type OutputFormat = 'md' | 'json' | 'html' | 'docx';

// ========== Provider Limits ==========

export interface ProviderLimits {
  maxPages: number;
  maxFileSizeMB: number;
  requiresToken: boolean;
  dailyQuotaPages: number;    // -1 = unlimited
  supportsFormats: FileType[];
  outputFormats: OutputFormat[];
}

// ========== Task ==========

export interface Chunk {
  chunkSequence: number;
  chunkPath: string;
  pageStart?: number;
  pageEnd?: number;
  taskId?: string;
  chunkState: ChunkState;
  resultUrl?: string;
  progress: number;            // 0-100
  errorCode?: string;
  errorMsg?: string;
  retryCount?: number;
}

export interface Task {
  jobId: string;
  originalName: string;
  sourcePaths: string[];
  fileType: FileType;
  fileSize: number;            // bytes
  pageCount: number;
  outputFormats: OutputFormat[];
  outputDir: string;
  state: TaskState;
  progress: number;            // 0-100
  currentChunk?: number;
  totalChunks?: number;
  chunks: Chunk[];
  errorCode?: string;
  errorMsg?: string;
  retryCount: number;
  providerUsed?: ProviderType;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  elapsed: number;             // ms
}

// ========== Settings ==========

export interface ProviderCredentials {
  mineruCloud: { baseUrl: string; token: string };
  paddleocrCloud: { token: string };
  paddleocrLocal: { enabled: boolean; port: number; pythonPath: string };
}

// Per-provider settings for the UI settings panel (keyed by ProviderId)
export interface ProviderEntry {
  enabled: boolean;
  baseUrl?: string;
  token?: string;
  model?: string;
  port?: number;
  pythonPath?: string;
  type?: string;               // e.g. 'LM Studio', 'llama.cpp', 'vLLM'
  extraOptions?: Record<string, boolean>;
}

export interface AppSettings {
  providers: ProviderCredentials;
  providerPriority: ProviderType[];
  outputDir: string;
  outputFormats: OutputFormat[];
  outputFileNameTemplate: string;
  concurrency: number;         // 1-8
  maxChunksPerFile: number;    // 1-6
  chunkSize: number;           // pages per chunk (5/10/15/20)
  theme: 'light' | 'dark' | 'auto';
  autoStart: boolean;
  // Post-processing toggles
  autoExtractZip: boolean;
  deleteChunkTemp: boolean;
  keepImages: boolean;
  imageOutputDir: string;
  // Local inference
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
  // Extended provider settings (UI-only, as flat map)
  extendedProviders?: Record<string, ProviderEntry>;
}

// ========== Provider Health ==========

export interface ProviderStatus {
  type: ProviderType;
  available: boolean;
  quotaExhausted: boolean;
  lastError?: string;
  lastChecked: string;
}

// Extended status for UI providers (Ollama, etc.)
export interface ProviderStatusExtended {
  id: ProviderId;
  name: string;
  online: boolean;
  enabled?: boolean;
  pagesUsedToday?: number;
  dailyLimit?: number;
  quotaLabel: string;
}

// ========== Page Counter ==========

export interface PageCountRecord {
  date: string;
  provider: ProviderType;
  pagesProcessed: number;
  pagesFailed: number;
}

export interface ProviderQuotaInfo {
  provider: ProviderType;
  dailyLimit: number;
  usedToday: number;
  failedToday: number;
  remaining: number;
  percentUsed: number;
}

// ========== Log & Progress ==========

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'debug';
  jobId?: string;
  message: string;
}

export interface GlobalProgress {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  pct: number;
  chunkTotal?: number;
  chunkCompleted?: number;
}

// ========== File Info ==========

export interface FileInfo {
  path: string;
  name: string;
  type: FileType;
  sizeBytes: number;
  pageCount: number;
  sha256: string;              // first 4MB hash
}

// ========== Provider Limits Registry ==========

export const PROVIDER_LIMITS: Record<ProviderType, ProviderLimits> = {
  'mineru-cloud': {
    maxPages: 200,
    maxFileSizeMB: 200,
    requiresToken: true,
    dailyQuotaPages: 1000,
    supportsFormats: ['pdf', 'pptx', 'docx', 'xlsx', 'image'],
    outputFormats: ['md', 'json', 'html', 'docx']
  },
  'paddleocr-cloud': {
    maxPages: 100,
    maxFileSizeMB: 50,
    requiresToken: true,
    dailyQuotaPages: 20000,
    supportsFormats: ['pdf', 'pptx', 'ppt', 'doc', 'docx', 'txt', 'wps', 'ofd', 'image'],
    outputFormats: ['md', 'json']
  },
  'paddleocr-local': {
    maxPages: 999999,
    maxFileSizeMB: 999999,
    requiresToken: false,
    dailyQuotaPages: -1,
    supportsFormats: ['pdf', 'image'],
    outputFormats: ['md', 'json']
  }
};

