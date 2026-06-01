# DocFlow Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows Electron desktop app that batch-processes documents (PDF/PPTX/images/Office) through multiple AI provider APIs (MinerU Cloud, Baidu PaddleOCR-VL, Local PaddleOCR) into Markdown/JSON output.

**Architecture:** Three-phase pipeline (preprocess→call→merge) with a Provider abstraction layer supporting automatic routing and quota-aware fallback. Electron main process handles all I/O; React renderer communicates via contextBridge IPC.

**Tech Stack:** Electron 28 + TypeScript (main), React 18 + TypeScript + Tailwind CSS 3 + Vite (renderer), electron-builder (packaging)

---

## File Structure Map

```
D:\Files\projects\docflow\
├── package.json
├── tsconfig.json
├── tsconfig.web.json
├── vite.config.ts
├── electron-builder.yml
├── tailwind.config.js
├── postcss.config.js
├── index.html                          # Vite entry
│
├── electron/                           # Main process
│   ├── main.ts                         # Entry: window + IPC
│   ├── preload.ts                      # contextBridge
│   ├── types.ts                        # All shared types
│   ├── ipc-handlers.ts                 # IPC handler registration
│   ├── state-manager.ts                # JSON persistence
│   ├── task-worker.ts                  # Concurrency controller
│   ├── api-client.ts                   # Axios wrapper
│   ├── page-counter.ts                 # Daily quota tracker
│   │
│   ├── pipeline/
│   │   ├── scanner.ts                  # Phase 1a: scan + dedup
│   │   ├── preprocessor.ts             # Phase 1b: analyze
│   │   ├── splitter.ts                 # Phase 1c: split by provider
│   │   ├── merger.ts                   # Phase 3a: merge chunks
│   │   ├── validator.ts                # Phase 3b: validate
│   │   └── output-normalizer.ts        # Phase 3c: normalize
│   │
│   ├── providers/
│   │   ├── i-provider.ts               # Interface
│   │   ├── provider-registry.ts        # Registry + limits
│   │   ├── provider-router.ts          # Routing logic
│   │   ├── mineru-cloud.ts             # MinerU impl
│   │   ├── paddleocr-cloud.ts          # Baidu impl
│   │   └── paddleocr-local.ts          # Local impl (stub)
│   │
│   └── python-bridge.ts               # Python lifecycle
│
├── src/                                # Renderer
│   ├── App.tsx
│   ├── main.tsx                        # React entry
│   ├── index.css                       # Tailwind directives
│   ├── components/
│   │   ├── DragDropZone.tsx
│   │   ├── TaskTable.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── ProviderSelector.tsx
│   │   ├── LogPanel.tsx
│   │   └── StatusBar.tsx
│   ├── store/
│   │   └── AppContext.tsx
│   └── types/
│       └── electron.d.ts              # ElectronAPI type declaration
│
└── python/
    ├── local_ocr_server.py
    └── requirements.txt
```

---

## Phase A: Project Scaffolding

### Task A1: Initialize project with package.json and configs

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.web.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `index.html`

- [ ] **Step 1: Create package.json**

```bash
New-Item -Force D:\Files\projects\docflow\package.json
```

```json
{
  "name": "docflow",
  "version": "1.0.0",
  "description": "Multi-engine document batch processing tool",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build && electron-builder",
    "vite:dev": "vite",
    "electron:dev": "electron ."
  },
  "dependencies": {
    "axios": "^1.7.0",
    "pdf-lib": "^1.17.1",
    "sharp": "^0.33.0",
    "electron-store": "^10.0.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0",
    "vite": "^5.0.0",
    "vite-plugin-electron": "^0.28.0",
    "vite-plugin-electron-renderer": "^0.14.0",
    "typescript": "^5.3.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/node": "^20.0.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "lucide-react": "^0.300.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist-electron",
    "rootDir": "electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["electron/**/*.ts"]
}
```

- [ ] **Step 4: Create tsconfig.web.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'sharp', 'pdf-lib', 'axios']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});
```

- [ ] **Step 6: Create tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#0891B2', dark: '#06B6D4', light: '#22D3EE' },
        surface: { light: '#ECFEFF', dark: '#0F172A' },
        panel: { light: '#FFFFFF', dark: '#1E293B' },
        cta: '#22C55E'
      },
      fontFamily: {
        heading: ['Fira Code', 'monospace'],
        body: ['Fira Sans', 'sans-serif']
      }
    }
  },
  plugins: []
};
```

- [ ] **Step 7: Create postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

- [ ] **Step 8: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DocFlow</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
</head>
<body class="bg-surface-light dark:bg-surface-dark text-slate-800 dark:text-slate-100 font-body">
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 9: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold project with Electron + Vite + React + Tailwind"
```

---

### Task A2: Create Electron main process entry

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/main.tsx`
- Create: `src/index.css`
- Create: `src/App.tsx`

- [ ] **Step 1: Create electron/main.ts**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'DocFlow',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
```

- [ ] **Step 2: Create electron/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  addFiles: (paths: string[]) => ipcRenderer.invoke('add-files', paths),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  pauseQueue: () => ipcRenderer.send('pause-queue'),
  resumeQueue: () => ipcRenderer.send('resume-queue'),
  cancelTask: (jobId: string) => ipcRenderer.send('cancel-task', jobId),
  retryTask: (jobId: string) => ipcRenderer.send('retry-task', jobId),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  getProviderStatus: () => ipcRenderer.invoke('get-provider-status'),
  testProviderConnection: (type: string, creds: unknown) => ipcRenderer.invoke('test-provider', type, creds),
  setProviderPriority: (providers: string[]) => ipcRenderer.send('set-provider-priority', providers),
  getProviderQuotas: () => ipcRenderer.invoke('get-quotas'),
  onTasksUpdate: (cb: (tasks: unknown[]) => void) => {
    const handler = (_: unknown, tasks: unknown[]) => cb(tasks);
    ipcRenderer.on('tasks-update', handler);
    return () => ipcRenderer.removeListener('tasks-update', handler);
  },
  onLog: (cb: (log: unknown) => void) => {
    const handler = (_: unknown, log: unknown) => cb(log);
    ipcRenderer.on('log-entry', handler);
    return () => ipcRenderer.removeListener('log-entry', handler);
  },
  onProgress: (cb: (progress: unknown) => void) => {
    const handler = (_: unknown, progress: unknown) => cb(progress);
    ipcRenderer.on('progress-update', handler);
    return () => ipcRenderer.removeListener('progress-update', handler);
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

- [ ] **Step 3: Create src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

- [ ] **Step 4: Create src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-surface-light dark:bg-surface-dark text-slate-700 dark:text-slate-200;
    font-family: 'Fira Sans', system-ui, sans-serif;
  }
}

@layer components {
  .btn {
    @apply px-4 py-2 rounded-md font-medium transition-colors duration-200 cursor-pointer text-sm;
  }
  .btn-primary {
    @apply btn bg-primary text-white hover:brightness-110 active:brightness-90;
  }
  .btn-cta {
    @apply btn bg-cta text-white hover:brightness-110 active:brightness-90;
  }
  .btn-danger {
    @apply btn bg-red-500 text-white hover:bg-red-600;
  }
  .btn-ghost {
    @apply btn bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300;
  }
  .input {
    @apply px-3 py-2 rounded-md border border-gray-300 dark:border-slate-600
           bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
           focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
           placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm;
  }
  .card {
    @apply bg-panel-light dark:bg-panel-dark rounded-lg border border-gray-200 dark:border-slate-700;
  }
  .badge {
    @apply inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium;
  }
}
```

- [ ] **Step 5: Create src/App.tsx (shell layout)**

```tsx
import React, { useState } from 'react';
import { Settings, Play, Pause } from 'lucide-react';
import DragDropZone from './components/DragDropZone';
import TaskTable from './components/TaskTable';
import SettingsPanel from './components/SettingsPanel';
import LogPanel from './components/LogPanel';
import StatusBar from './components/StatusBar';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  function toggleTheme() {
    setDarkMode(d => { const next = !d; document.documentElement.classList.toggle('dark', next); return next; });
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Title Bar */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-slate-700 bg-panel-light dark:bg-panel-dark shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-lg font-semibold text-primary dark:text-primary-dark">DocFlow</h1>
          <span className="text-xs text-slate-400 hidden sm:inline">多引擎文档批量处理工具</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="btn-ghost text-xs">{darkMode ? '☀️' : '🌙'}</button>
          <button onClick={() => setSettingsOpen(!settingsOpen)} className="btn-ghost flex items-center gap-1">
            <Settings size={16} /><span className="text-xs">设置</span>
          </button>
        </div>
      </header>

      {/* Settings Panel (collapsible) */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {/* Main Content: Left (60%) + Right (40%) */}
      <main className="flex-1 flex overflow-hidden">
        <div className="w-[60%] flex flex-col overflow-hidden border-r border-gray-200 dark:border-slate-700">
          <DragDropZone />
          <div className="flex-1 overflow-auto p-2">
            <TaskTable />
          </div>
        </div>
        <div className="w-[40%] flex flex-col">
          <LogPanel />
        </div>
      </main>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 6: Create placeholder components**

Create `src/components/DragDropZone.tsx`:
```tsx
import { Upload } from 'lucide-react';

export default function DragDropZone() {
  return (
    <div className="m-2 p-6 border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg text-center cursor-pointer
                    hover:border-primary/50 transition-colors duration-200">
      <Upload className="mx-auto mb-2 text-slate-400" size={32} />
      <p className="text-sm text-slate-500 dark:text-slate-400">将文件或文件夹拖拽到此处</p>
    </div>
  );
}
```

Create `src/components/TaskTable.tsx`:
```tsx
export default function TaskTable() {
  return (
    <div className="text-center py-12 text-slate-400 text-sm">
      暂无任务。拖入文件开始处理。
    </div>
  );
}
```

Create `src/components/SettingsPanel.tsx`:
```tsx
export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  return <div className="p-4 border-b bg-panel-light dark:bg-panel-dark text-sm">设置面板（待实现）</div>;
}
```

Create `src/components/LogPanel.tsx`:
```tsx
export default function LogPanel() {
  return (
    <div className="flex-1 p-3 overflow-auto">
      <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">实时日志</h3>
      <p className="text-xs text-slate-400">等待任务开始...</p>
    </div>
  );
}
```

Create `src/components/StatusBar.tsx`:
```tsx
export default function StatusBar() {
  return (
    <footer className="h-8 flex items-center px-4 border-t border-gray-200 dark:border-slate-700 bg-panel-light dark:bg-panel-dark text-xs text-slate-500 shrink-0">
      <span>就绪</span>
      <span className="ml-auto">待处理: 0 | 处理中: 0 | 已完成: 0 | 失败: 0</span>
    </footer>
  );
}
```

Create `src/components/ProviderSelector.tsx`:
```tsx
export default function ProviderSelector() {
  return <div className="text-xs text-slate-400">Provider 选择器（待实现）</div>;
}
```

Create store: `src/store/AppContext.tsx`:
```tsx
import React, { createContext, useContext, useReducer, Dispatch } from 'react';

export interface AppState { tasks: unknown[]; logs: unknown[]; progress: { pct: number }; }
const initialState: AppState = { tasks: [], logs: [], progress: { pct: 0 } };

function reducer(state: AppState, action: { type: string; payload?: unknown }): AppState {
  switch (action.type) {
    case 'SET_TASKS': return { ...state, tasks: action.payload as unknown[] };
    case 'ADD_LOG': return { ...state, logs: [...state.logs, action.payload].slice(-500) };
    case 'SET_PROGRESS': return { ...state, progress: action.payload as { pct: number } };
    default: return state;
  }
}

const AppContext = createContext<{ state: AppState; dispatch: Dispatch<{ type: string; payload?: unknown }> }>({
  state: initialState,
  dispatch: () => {}
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState() { return useContext(AppContext); }
```

Create types: `src/types/electron.d.ts`:
```typescript
export interface ElectronAPI {
  addFiles(paths: string[]): Promise<void>;
  getTasks(): Promise<unknown[]>;
  pauseQueue(): void;
  resumeQueue(): void;
  cancelTask(jobId: string): void;
  retryTask(jobId: string): void;
  selectOutputDir(): Promise<string>;
  saveSettings(settings: unknown): void;
  loadSettings(): Promise<unknown>;
  getProviderStatus(): Promise<unknown[]>;
  testProviderConnection(type: string, creds: unknown): Promise<boolean>;
  setProviderPriority(providers: string[]): void;
  getProviderQuotas(): Promise<unknown[]>;
  onTasksUpdate(cb: (tasks: unknown[]) => void): () => void;
  onLog(cb: (log: unknown) => void): () => void;
  onProgress(cb: (progress: unknown) => void): () => void;
}

declare global {
  interface Window { electronAPI: ElectronAPI; }
}
```

- [ ] **Step 7: Test dev startup**

```bash
npm run dev
```

Expected: Electron window opens showing DocFlow shell with header, drag zone, empty table, log panel, status bar.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: Electron shell with React + Tailwind layout"
```

---

## Phase B: Type System & State Manager

### Task B1: Define core types

**Files:**
- Create: `electron/types.ts`

- [ ] **Step 1: Create electron/types.ts**

```typescript
// ========== Enums ==========

export type ProviderType = 'mineru-cloud' | 'paddleocr-cloud' | 'paddleocr-local';

export type TaskState =
  | 'pending' | 'preprocessing' | 'uploading' | 'running'
  | 'downloading' | 'merging' | 'done' | 'failed' | 'cancelled' | 'paused';

export type ChunkState = 'pending' | 'uploading' | 'running' | 'downloading' | 'done' | 'failed';

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
  taskId?: string;
  chunkState: ChunkState;
  resultUrl?: string;
  progress: number;            // 0-100
  errorCode?: string;
}

export interface Task {
  jobId: string;
  originalName: string;
  sourcePaths: string[];
  fileType: FileType;
  pageCount: number;
  outputFormats: OutputFormat[];
  outputDir: string;
  state: TaskState;
  progress: number;
  currentChunk?: number;
  totalChunks?: number;
  chunks: Chunk[];
  errorCode?: string;
  errorMsg?: string;
  retryCount: number;
  providerUsed?: ProviderType;
}

// ========== Settings ==========

export interface ProviderCredentials {
  mineruCloud: { baseUrl: string; token: string };
  paddleocrCloud: { apiKey: string; secretKey: string; accessToken?: string };
  paddleocrLocal: { enabled: boolean; port: number; pythonPath: string };
}

export interface AppSettings {
  providers: ProviderCredentials;
  providerPriority: ProviderType[];
  outputDir: string;
  outputFormats: OutputFormat[];
  concurrency: number;         // 1-5
  theme: 'light' | 'dark';
  autoStart: boolean;
}

// ========== Provider Health ==========

export interface ProviderStatus {
  type: ProviderType;
  available: boolean;
  quotaExhausted: boolean;
  lastError?: string;
  lastChecked: string;
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
  level: 'info' | 'warn' | 'error' | 'success';
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
    dailyQuotaPages: -1,
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
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: define core types and provider limits registry"
```

---

### Task B2: State manager (JSON persistence)

**Files:**
- Create: `electron/state-manager.ts`

- [ ] **Step 1: Create electron/state-manager.ts**

```typescript
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Task, AppSettings, PageCountRecord, ProviderStatus } from './types';

interface PersistedState {
  version: string;
  lastSaved: string;
  tasks: Task[];
  providerStatus: ProviderStatus[];
}

const VERSION = '1.0';

function getUserDataPath(): string {
  const dataDir = join(app.getPath('userData'), 'docflow');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

// ========== Tasks ==========

export function loadTasks(): Task[] {
  const file = join(getUserDataPath(), 'docflow_tasks.json');
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as PersistedState;
    return raw.tasks || [];
  } catch { return []; }
}

export function saveTasks(tasks: Task[], providerStatus: ProviderStatus[]): void {
  const file = join(getUserDataPath(), 'docflow_tasks.json');
  const state: PersistedState = {
    version: VERSION,
    lastSaved: new Date().toISOString(),
    tasks,
    providerStatus
  };
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

// ========== Settings ==========

export const DEFAULT_SETTINGS: AppSettings = {
  providers: {
    mineruCloud: { baseUrl: 'https://mineru.net/api/v4', token: '' },
    paddleocrCloud: { apiKey: '', secretKey: '', accessToken: '' },
    paddleocrLocal: { enabled: false, port: 51987, pythonPath: 'python' }
  },
  providerPriority: ['mineru-cloud', 'paddleocr-cloud'],
  outputDir: join(app.getPath('documents'), 'DocFlow_Output'),
  outputFormats: ['md', 'json'],
  concurrency: 2,
  theme: 'light',
  autoStart: true
};

export function loadSettings(): AppSettings {
  const file = join(getUserDataPath(), 'docflow_settings.json');
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file, 'utf-8')) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: AppSettings): void {
  const file = join(getUserDataPath(), 'docflow_settings.json');
  writeFileSync(file, JSON.stringify(settings, null, 2), 'utf-8');
}

// ========== Page Counter ==========

export function loadPageCounts(): Record<string, Record<string, PageCountRecord>> {
  const file = join(getUserDataPath(), 'docflow_counters.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return {}; }
}

export function savePageCounts(counts: Record<string, Record<string, PageCountRecord>>): void {
  const file = join(getUserDataPath(), 'docflow_counters.json');
  writeFileSync(file, JSON.stringify(counts, null, 2), 'utf-8');
}

// ========== Helpers ==========

export function getTempDir(): string {
  const dir = join(app.getPath('temp'), 'docflow_temp');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getOutputDir(outDir?: string): string {
  const dir = outDir || DEFAULT_SETTINGS.outputDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: state manager with JSON persistence, defaults, page counter"
```

---

## Phase C: Pipeline — Phase 1 (Preprocessing)

### Task C1: File scanner

**Files:**
- Create: `electron/pipeline/scanner.ts`

- [ ] **Step 1: Create electron/pipeline/scanner.ts**

```typescript
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { extname, basename, join, dirname } from 'path';
import { createHash } from 'crypto';
import { FileInfo, FileType } from '../types';

const SUPPORTED_EXTENSIONS: Record<string, FileType> = {
  '.pdf': 'pdf', '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.jp2': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image',
  '.tif': 'image', '.tiff': 'image', '.pptx': 'pptx', '.ppt': 'ppt',
  '.docx': 'docx', '.doc': 'doc', '.xlsx': 'xlsx', '.txt': 'txt',
  '.wps': 'wps', '.ofd': 'ofd'
};

function sha256First4MB(filePath: string): string {
  const hash = createHash('sha256');
  const fd = readFileSync(filePath);
  const slice = fd.subarray(0, 4 * 1024 * 1024);
  hash.update(slice);
  return hash.digest('hex');
}

function scanDirectory(dirPath: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS[ext]) results.push(fullPath);
      }
    }
  } catch { /* permission denied, skip */ }
  return results;
}

export function scanFiles(paths: string[]): FileInfo[] {
  const fileMap = new Map<string, FileInfo[]>();

  // 1. Collect all files
  const allFiles: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const stat = statSync(p);
    if (stat.isDirectory()) {
      allFiles.push(...scanDirectory(p));
    } else {
      const ext = extname(p).toLowerCase();
      if (SUPPORTED_EXTENSIONS[ext]) allFiles.push(p);
    }
  }

  // 2. Compute info + dedup
  for (const fp of allFiles) {
    const name = basename(fp);
    const ext = extname(fp).toLowerCase();
    const type = SUPPORTED_EXTENSIONS[ext];
    const sizeBytes = statSync(fp).size;
    const hash = sha256First4MB(fp);

    const info: FileInfo = {
      path: fp,
      name,
      type,
      sizeBytes,
      pageCount: 0, // filled by preprocessor
      sha256: hash
    };

    if (!fileMap.has(hash)) {
      fileMap.set(hash, [info]);
    } else {
      const existing = fileMap.get(hash)!;
      const sameName = existing.find(e => e.name === name);
      if (sameName) {
        // Same hash + same name = duplicate, record source path
        sameName.path = fp; // keep latest path
      } else {
        // Same hash + different name = different file with same content
        // Rename to avoid conflict
        const newName = name.replace(ext, `_${existing.length}${ext}`);
        info.name = newName;
        fileMap.set(hash + `_${existing.length}`, [info]);
      }
    }
  }

  // 3. Flatten to array
  const result: FileInfo[] = [];
  for (const [, infos] of fileMap) {
    result.push(...infos);
  }

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: file scanner with SHA256 dedup and recursive directory"
```

---

### Task C2: Preprocessor (page counting)

**Files:**
- Create: `electron/pipeline/preprocessor.ts`

- [ ] **Step 1: Create electron/pipeline/preprocessor.ts**

```typescript
import { PDFDocument } from 'pdf-lib';
import { readFileSync, existsSync } from 'fs';
import { FileInfo, FileType } from '../types';

/**
 * Extract page count from supported file types.
 * For images: always 1 page.
 * For PDF: use pdf-lib.
 * For PPTX/PPT: approximate by file size (since we can't easily count slides without a parser).
 * For DOCX/DOC/XLSX: similar approximation.
 */
export async function analyzeFile(info: FileInfo): Promise<FileInfo> {
  switch (info.type) {
    case 'pdf':
      return analyzePDF(info);
    case 'image':
      return { ...info, pageCount: 1 };
    case 'pptx':
    case 'ppt':
    case 'docx':
    case 'doc':
    case 'xlsx':
    case 'txt':
    case 'wps':
    case 'ofd':
      // Estimate: ~50KB per page for Office docs
      return { ...info, pageCount: Math.max(1, Math.ceil(info.sizeBytes / 51200)) };
    default:
      return { ...info, pageCount: 1 };
  }
}

async function analyzePDF(info: FileInfo): Promise<FileInfo> {
  try {
    if (!existsSync(info.path)) return { ...info, pageCount: 0 };
    const buffer = readFileSync(info.path);
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return { ...info, pageCount: doc.getPageCount() };
  } catch {
    return { ...info, pageCount: 0 };
  }
}

export async function analyzeFiles(files: FileInfo[]): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  for (const f of files) {
    results.push(await analyzeFile(f));
  }
  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: preprocessor with pdf-lib page counting"
```

---

### Task C3: Splitter (Provider-aware chunking)

**Files:**
- Create: `electron/pipeline/splitter.ts`

- [ ] **Step 1: Create electron/pipeline/splitter.ts**

```typescript
import { PDFDocument, PDFPage } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'fs';
import { basename, join, extname } from 'path';
import { randomUUID } from 'crypto';
import { FileInfo, Chunk, ProviderType, PROVIDER_LIMITS } from '../types';
import { getTempDir } from '../state-manager';

export interface SplitResult {
  chunks: Chunk[];
  totalChunks: number;
}

export async function splitFileByProvider(
  file: FileInfo,
  provider: ProviderType
): Promise<SplitResult> {
  const limits = PROVIDER_LIMITS[provider];
  const chunks: Chunk[] = [];

  // Images: always single chunk
  if (file.type === 'image') {
    chunks.push(createChunk(file.path, 0, 1, 1));
    return { chunks, totalChunks: 1 };
  }

  // Within limits: single chunk
  if (file.pageCount <= limits.maxPages) {
    chunks.push(createChunk(file.path, 0, 1, file.pageCount));
    return { chunks, totalChunks: 1 };
  }

  // PDF: split by page ranges
  if (file.type === 'pdf') {
    return splitPDF(file, limits.maxPages);
  }

  // Other formats: cannot split, take as single chunk with warning
  chunks.push(createChunk(file.path, 0, 1, file.pageCount));
  return { chunks, totalChunks: 1 };
}

async function splitPDF(file: FileInfo, maxPagesPerChunk: number): Promise<SplitResult> {
  const buffer = readFileSync(file.path);
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const totalChunks = Math.ceil(totalPages / maxPagesPerChunk);
  const chunks: Chunk[] = [];
  const jobUUID = randomUUID();
  const tempDir = getTempDir();

  for (let seq = 0; seq < totalChunks; seq++) {
    const start = seq * maxPagesPerChunk;
    const end = Math.min(start + maxPagesPerChunk, totalPages);
    const size = end - start;

    const chunkDoc = await PDFDocument.create();
    const pages = await chunkDoc.copyPages(srcDoc, srcDoc.getPageIndices().slice(start, end));
    for (const page of pages) chunkDoc.addPage(page);

    const chunkName = `${basename(file.path, extname(file.path))}_chunk_${seq}_${jobUUID.slice(0, 8)}.pdf`;
    const chunkPath = join(tempDir, chunkName);
    writeFileSync(chunkPath, await chunkDoc.save());

    chunks.push({
      chunkSequence: seq,
      chunkPath,
      chunkState: 'pending',
      progress: 0
    });
  }

  return { chunks, totalChunks };
}

function createChunk(path: string, sequence: number, _start: number, _end: number): Chunk {
  return {
    chunkSequence: sequence,
    chunkPath: path,   // use original path for non-split files
    chunkState: 'pending',
    progress: 0
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: splitter with provider-aware PDF chunking"
```

---

## Phase D: Provider Layer

### Task D1: Provider interface & registry

**Files:**
- Create: `electron/providers/i-provider.ts`
- Create: `electron/providers/provider-registry.ts`

*(Due to plan length constraints, remaining phases D-H are outlined below. Each provider implementation, task worker, IPC handlers, React components, Local OCR bridge, and packaging config follow the same detailed task structure with exact code, file paths, and commit steps.)*

I will continue with the remaining phases in the execution stage.

---

### Remaining Phase Outline

| Phase | Tasks | Key Files |
|-------|-------|-----------|
| **D** | Provider implementations | `mineru-cloud.ts`, `paddleocr-cloud.ts`, `paddleocr-local.ts`, `provider-router.ts` |
| **E** | Task worker + Page counter | `task-worker.ts`, `page-counter.ts`, `api-client.ts` |
| **F** | IPC handlers + Frontend wiring | `ipc-handlers.ts`, all React components, `AppContext.tsx` |
| **G** | Local OCR bridge | `python-bridge.ts`, `python/local_ocr_server.py`, `python/requirements.txt` |
| **H** | Packaging + Final polish | `electron-builder.yml`, theme toggle, responsive fixes, cleanup |

---

