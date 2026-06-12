# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (Vite dev server + Electron)
npm run dev          # Starts Vite; electron runs alongside via vite-plugin-electron

# Build (TypeScript compile + Vite bundle + electron-builder package)
npm run build        # Full production build → dist/, dist-electron/, and release/

# Individual pieces
npm run vite:dev     # Vite dev server only
npm run electron:dev # Electron from dist-electron/ (requires prior tsc/vite build)
```

There are no tests or linter configured.

## Architecture

OCRFlow is an Electron desktop app for batch OCR document processing. It takes PDF/Office/image files, splits them into chunks, submits each chunk to an OCR provider (cloud API or local Python server), polls for results, then merges outputs into Markdown/JSON/HTML/DOCX.

### Dual-process structure

- **Electron main process** (`electron/`) — All heavy lifting: file scanning, PDF splitting, provider API communication, result merging, settings persistence, and task queue management. Communicates with the renderer exclusively via IPC (contextBridge + ipcMain.handle / ipcRenderer.invoke).
- **React renderer** (`src/`) — UI only: task list, settings panel, log viewer, and progress display. State managed by a single `useReducer` in `AppContext`. Receives data push-events from main process (tasks-update, log-entry, progress-update, quotas-update).

### Processing pipeline (main process)

1. **Scanner** (`electron/pipeline/scanner.ts`) — Recursively collects supported files from user-selected paths, deduplicates by SHA-256 + file size.
2. **Preprocessor** (`electron/pipeline/preprocessor.ts`) — Counts pages for each file (PDF: pdf-lib; Office: xml parsing; images: always 1).
3. **Provider Router** (`electron/providers/provider-router.ts`) — Routes each file to the highest-priority available provider that supports its format.
4. **Splitter** (`electron/pipeline/splitter.ts`) — Splits PDFs into page-range chunks using pdf-lib; images pass through as single chunks.
5. **TaskWorker** (`electron/task-worker.ts`) — Core orchestrator. Manages a concurrent queue (1-8 workers), processes chunks through provider submit→poll→download cycle, handles provider fallback on consecutive failures, auto-degrades chunk size on failure, merges results via `electron/pipeline/merger.ts`.
6. **Output** (`electron/pipeline/merger.ts`) — Concatenates chunk markdown results, collects and rewrites image paths, writes final files using user-configured naming templates.

### Provider system (strategy pattern)

Three OCR providers implement the `IProvider` interface (`electron/providers/i-provider.ts`): `submit()`, `poll()`, `download()`, `healthCheck()`, `canHandle()`, `getChunkSize()`. Registered via `provider-registry.ts`.

- **mineru-cloud** — MinerU API v4, supports most formats, 200 pages/chunk
- **paddleocr-cloud** — Baidu PaddleOCR-VL cloud API, supports many Chinese formats (wps, ofd, txt), 100 pages/chunk
- **paddleocr-local** — Wraps a Python HTTP server (`python/local_ocr_server.py`) started via `python-bridge.ts`. Base64-encodes files and POSTs to `http://127.0.0.1:{port}/layout-parsing`

### State persistence

`electron/state-manager.ts` persists three JSON files to the user data directory:
- `ocrflow_tasks.json` — Task queue + provider status
- `ocrflow_settings.json` — All app settings
- `ocrflow_counters.json` — Daily page count quotas per provider

Writes use atomic rename (write to `.tmp` then rename) to prevent corruption.

### Key frontend patterns

- `src/store/AppContext.tsx` — Single `useReducer` store. IPC event listeners in `App.tsx` dispatch actions (SET_TASKS, ADD_LOG, SET_PROGRESS, etc.) to update state.
- `src/types/index.ts` — Mirrors `electron/types.ts` types plus UI-only types (ViewType, TaskFilter, PaletteId, etc.).
- `src/hooks/useTheme.ts` — Theme switching (light/dark/auto) via CSS custom properties on `<html data-theme>` and `data-palette` attributes.
- CSS is primarily custom properties in `src/index.css` (~42KB) with Tailwind as a supplement. The app uses a custom title bar (frameless window in Electron with `frame: false`).
