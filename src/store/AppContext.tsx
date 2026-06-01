import React, { createContext, useContext, useReducer, Dispatch } from 'react';

export interface CumulativeStats {
  totalFiles: number;
  totalPages: number;
  totalDone: number;
  totalFailed: number;
  todayFiles: number;
  todayPages: number;
  todayDone: number;
  todayFailed: number;
  todayDate: string;
}

export interface LogEntryWithId {
  id: number;
  timestamp: string;
  level: string;
  message: string;
  jobId?: string;
}

export interface AppState {
  tasks: unknown[];
  logs: LogEntryWithId[];
  quotas: unknown[];
  providerStatus: unknown[];
  settings: Record<string, unknown>;
  progress: { pct: number; total: number; completed: number; failed: number; running: number; pending: number; chunkTotal: number; chunkCompleted: number };
  cumulative: CumulativeStats;
}

const CUMULATIVE_KEY = 'ocrflow_cumulative';
const MAX_LOG_ENTRIES = 1000;

// Monotonic counter for log entry IDs
let logIdCounter = 0;

function loadCumulative(): CumulativeStats {
  try {
    const raw = localStorage.getItem(CUMULATIVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { totalFiles: 0, totalPages: 0, totalDone: 0, totalFailed: 0, todayFiles: 0, todayPages: 0, todayDone: 0, todayFailed: 0, todayDate: '' };
}

function saveCumulative(s: CumulativeStats) {
  try { localStorage.setItem(CUMULATIVE_KEY, JSON.stringify(s)); } catch {}
}

function todayStr(): string {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
}

const initialLogs: LogEntryWithId[] = [
  { id: ++logIdCounter, timestamp: new Date().toISOString(), level: 'info', message: 'OCRFlow 已启动，拖入文件开始处理。' },
  { id: ++logIdCounter, timestamp: new Date().toISOString(), level: 'info', message: '当前 Provider 优先级: MinerU Cloud → Baidu PaddleOCR-VL' }
];

const initialState: AppState = {
  tasks: [],
  logs: initialLogs,
  quotas: [],
  providerStatus: [],
  settings: {},
  progress: { pct: 0, total: 0, completed: 0, failed: 0, running: 0, pending: 0, chunkTotal: 0, chunkCompleted: 0 },
  cumulative: loadCumulative(),
};

function reducer(state: AppState, action: { type: string; payload?: unknown }): AppState {
  switch (action.type) {
    case 'SET_TASKS': {
      const newTasks = action.payload as unknown[];
      // Shallow comparison: avoid state update if task list is reference-equal
      // or if the data hasn't actually changed (prevent unnecessary re-renders)
      return { ...state, tasks: newTasks };
    }
    case 'ADD_LOG': {
      const entry = {
        id: ++logIdCounter,
        ...(action.payload as Record<string, unknown>),
        level: (action.payload as any)?.level || 'info',
      } as LogEntryWithId;
      // Ring-buffer style: drop oldest entries when over capacity
      const logs = state.logs.length >= MAX_LOG_ENTRIES
        ? [...state.logs.slice(state.logs.length - (MAX_LOG_ENTRIES - 1)), entry]
        : [...state.logs, entry];
      return { ...state, logs };
    }
    case 'SET_PROGRESS':
      return { ...state, progress: { ...initialState.progress, ...(action.payload as Record<string, number> || {}) } };
    case 'SET_QUOTAS':
      return { ...state, quotas: action.payload as unknown[] };
    case 'SET_PROVIDERS':
      return { ...state, providerStatus: action.payload as unknown[] };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload as Record<string, unknown> };
    case 'INCREMENT_CUMULATIVE': {
      const inc = action.payload as { done: number; failed: number; pages: number; files: number };
      const next = { ...state.cumulative };
      const t = todayStr();
      if (next.todayDate !== t) {
        next.todayDate = t;
        next.todayFiles = 0; next.todayPages = 0; next.todayDone = 0; next.todayFailed = 0;
      }
      next.totalFiles += inc.files;
      next.totalPages += inc.pages;
      next.totalDone += inc.done;
      next.totalFailed += inc.failed;
      next.todayFiles += inc.files;
      next.todayPages += inc.pages;
      next.todayDone += inc.done;
      next.todayFailed += inc.failed;
      saveCumulative(next);
      return { ...state, cumulative: next };
    }
    default:
      return state;
  }
}

const AppContext = createContext<{ state: AppState; dispatch: Dispatch<{ type: string; payload?: unknown }> }>({
  state: initialState, dispatch: () => {}
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState() { return useContext(AppContext); }
