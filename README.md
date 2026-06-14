# OCRFlow

Multi-engine OCR document batch processing tool. Parse PDF, Office, and image files using MinerU Cloud, PaddleOCR Cloud, or local OCR engines.

**Cross-platform** — Windows (installer + portable) and macOS (Apple Silicon).  
**Multi-engine** — MinerU Precision/Agent, PaddleOCR-VL Cloud, local OCR services.  
**Agent-ready** — Standard MCP tool `parse_documents` for AI agent integration.  
**Headless CLI** — Batch OCR from the command line, ideal for automation and CI.

---

## Installation

### Windows

| Format | How to use |
|--------|------------|
| **NSIS Installer** (`OCRFlow Setup 1.2.0.exe`) | Double-click, choose install path, done. Creates desktop + start menu shortcuts. |
| **Portable** (`OCRFlow-win-1.2.0.zip`) | Unzip anywhere, double-click `OCRFlow.exe`. No installation required. |

### macOS (Apple Silicon)

1. Download `OCRFlow-1.2.0-arm64-mac.zip`
2. Unzip → drag `OCRFlow.app` to `/Applications`
3. First launch: **right-click** the app → **Open** → click **Open** in the dialog
4. Subsequent launches work with a normal double-click

> **Why right-click the first time?**  
> The app is ad-hoc signed (no Apple Developer certificate). macOS Gatekeeper requires one extra confirmation for unsigned apps.

### From Source

```bash
git clone https://github.com/L-iuhuan/ocr_project.git
cd ocr_project
npm install
npm run dev          # development mode
npm run build        # production build
```

**Requirements**: Node.js 18+. Python 3.8+ (optional, for local OCR engine only).

---

## Quick Start

### 1. Configure OCR providers

Open OCRFlow, go to **Settings → Providers**. At minimum you can use **MinerU Agent mode** without any token — it works out of the box for small files (≤10MB, ≤20 pages). For larger files or better quality, configure a MinerU token or PaddleOCR token.

### 2. Add files

Drag & drop files or folders into the app, or use the toolbar buttons.

### 3. Process

Click the play button to start processing. OCRFlow splits large PDFs into page-range chunks, submits each to the selected provider, polls for results, downloads outputs, and merges everything.

Supported inputs: PDF, PPTX, DOCX, XLSX, PNG, JPG, JPEG, WebP, GIF, BMP, TIFF, TXT, WPS, OFD

Output formats: Markdown, JSON, HTML, DOCX (configurable in Settings)

---

## Features

### OCR Providers

| Provider | Type | Description |
|----------|------|-------------|
| **MinerU Cloud** | Cloud API | Precision mode (token required, ≤200MB/file, ≤200 pages/chunk) or Agent mode (no token, ≤10MB/file, ≤20 pages/chunk). Supports PDF, PPTX, DOCX, XLSX, images. |
| **PaddleOCR Cloud** | Cloud API | PaddleOCR-VL API. Supports many Chinese document formats including WPS, OFD. |
| **Local OCR Engine** | Local | Connect to any local OCR service that provides a `/layout-parsing` POST endpoint (PaddleOCR, MinerU local, etc.). OCRFlow can also auto-start a bundled Python server if configured. |

Provider priority is configurable — the first available provider is used, with automatic fallback if a provider fails.

### Headless CLI

Process documents from the command line without opening the GUI:

```bash
# Single file
OCRFlow.exe --headless parse "D:\docs\report.pdf" --out "D:\ocr-output"

# Batch folder
OCRFlow.exe --headless parse "D:\docs\2026" --providers mineru-cloud,paddleocr-cloud --json

# Development environment
npm run parse -- "D:\docs\report.pdf" --provider mineru-cloud --json
```

Options:

| Flag | Description |
|------|-------------|
| `--out <dir>` | Output directory (default: from GUI settings) |
| `--provider <name>` | Single provider: `mineru-cloud`, `paddleocr-cloud`, `paddleocr-local` |
| `--providers <list>` | Fallback order, comma-separated |
| `--concurrency <n>` | Parallel tasks (1-8) |
| `--chunk-size <n>` | Pages per chunk |
| `--json` | Output machine-readable JSON summary |
| `--help` | Print usage |

### MCP Server (AI Agent Integration)

OCRFlow exposes a standard MCP stdio server with the `parse_documents` tool. Any MCP-compatible agent (Claude Code, Claude Desktop, Cursor, OpenCode, WorkBuddy, QCode) can call it directly.

**Setup**: Open OCRFlow → **Settings → Agent/MCP** → copy the auto-generated prompt or JSON config.

**Tool signature**:

```json
{
  "paths": ["C:/Users/yourname/Documents/report.pdf"],
  "outputDir": "C:/Users/yourname/Desktop/ocr-output",
  "providers": ["mineru-cloud", "paddleocr-cloud"]
}
```

All parameters except `paths` are optional. Provider tokens are reused from GUI settings.
Packaged app bundles own Node.js runtime — no separate Node.js installation needed.

### Image Handling

OCRFlow preserves images from OCR results:

- Images extracted from provider downloads are saved to `images/` under the output directory.
- Markdown image references are rewritten to match the output structure.
- Set `keepImages: false` in Settings to skip image collection.
- The `images/` directory is only created when images are actually present.

### Workspace & Retry

Each task has a dedicated workspace under `outputDir/_ocrflow_tmp/{jobId}/`:

- Chunk PDFs and OCR results are stored per chunk with a manifest file.
- If a chunk fails (network error, download timeout), only the failed chunk is retried.
- Successfully completed chunks are never re-processed.
- Missing temp files are rebuilt from the original source PDF by page range.
- Workspaces are cleaned automatically when the task completes or is removed.
- App restart preserves active task workspaces for recovery.

### Output Naming

File naming follows a configurable template (Settings → General):

| Variable | Description |
|----------|-------------|
| `{name}` | Original filename (without extension) |
| `{date}` | `YYYY-MM-DD` |
| `{time}` | `HH-MM-SS` |
| `{timestamp}` | `YYYYMMDDHHMMSS` |

Default: `{date}/{name}` (files grouped by date in subdirectories).

### Theme & UI

- Dark / Light / Auto system theme with multiple color palettes (Lavender, Ice, Mint, Amber).
- Custom frameless title bar on Windows; native traffic-light buttons on macOS.
- Real-time log viewer with search and severity filtering.
- Task cards showing per-chunk progress, provider, elapsed time, file size.

---

## Settings Reference

### Providers

| Setting | Description |
|---------|-------------|
| MinerU Cloud → API Token | Token for Precision mode. Leave empty for Agent-only mode. |
| MinerU Cloud → Base URL | API endpoint (default: `https://mineru.net/api/v4`). |
| PaddleOCR Cloud → Access Token | Token from PaddleOCR console. Required. |
| Local OCR → Enabled | Enable local OCR engine. |
| Local OCR → Port | Port of the local OCR service (default: 51987). If a service is already running on this port, OCRFlow connects to it. |
| Local OCR → Python Path | Python executable path (default: `python3` on macOS, `python` on Windows). Used to auto-start a built-in server if no external service is detected. |

### General

| Setting | Description |
|---------|-------------|
| Output formats | Markdown / JSON / HTML / DOCX (multi-select). |
| Output directory | Where processed files are written. |
| File naming template | See Output Naming section above. |
| Concurrency | Number of parallel tasks (1-8). Default: 2. |
| Pages per chunk | PDF split granularity. Default: 20. |
| Auto-start queue | Start processing immediately after adding files. |

### Image & Temp

| Setting | Description |
|---------|-------------|
| Keep images | Extract and save images from OCR results (default: on). |
| Image output directory | Custom path for images (default: `{outputDir}/images`). |
| Auto-extract ZIP | Unpack provider ZIP results automatically. |
| Delete temp after done | Clean up temporary chunk files after successful processing. Partial failures keep temp data for retry. |

---

## Building from Source

### Prerequisites

- Node.js 18+
- npm
- (optional) Python 3.8+ with `paddleocr[all]` for local OCR

### Development

```bash
npm install
npm run dev          # Vite dev server + Electron
```

### Production Build

```bash
npm run build        # Windows: NSIS installer + win-unpacked
```

The build outputs to `release/`:
- `OCRFlow Setup 1.2.0.exe` — NSIS installer
- `win-unpacked/OCRFlow.exe` — portable, no installation

### macOS Build (CI)

macOS builds run on GitHub Actions. Artifacts are available from the Actions tab or the Releases page.

---

## Project Structure

```text
electron/              # Electron main process
├── main.ts            # App lifecycle, window creation
├── preload.ts         # contextBridge to renderer
├── ipc-handlers.ts    # IPC handlers (settings, file ops, providers)
├── task-worker.ts     # OCR task queue, chunk processing, retry logic
├── state-manager.ts   # JSON persistence (tasks, settings, counters)
├── python-bridge.ts   # Python subprocess management
├── headless-args.ts   # CLI argument parser
├── headless-runner.ts # CLI batch OCR orchestrator
├── mcp-server.ts      # MCP stdio server
├── types.ts           # Shared types
├── pipeline/          # Processing pipeline
│   ├── scanner.ts     # File discovery + dedup
│   ├── preprocessor.ts# Page counting
│   ├── splitter.ts    # PDF chunking
│   ├── merger.ts      # Output merge + HTML/DOCX generation
│   ├── validator.ts   # Pre-merge validation
│   └── task-workspace.ts # Manifest-based workspace tracking
└── providers/         # OCR provider implementations
    ├── i-provider.ts
    ├── mineru-cloud.ts
    ├── paddleocr-cloud.ts
    ├── paddleocr-local.ts
    ├── provider-registry.ts
    └── provider-router.ts

src/                   # React renderer
├── main.tsx           # Entry point
├── App.tsx            # Root component
├── index.css          # Theme + layout styles
├── constants.ts       # Shared state constants
├── store/AppContext.tsx   # Single useReducer store
├── types/index.ts     # UI types + ElectronAPI
├── hooks/useTheme.ts  # Theme switching
└── components/        # UI components
    ├── TopBar.tsx     # Custom title bar
    ├── Sidebar.tsx    # Task list sidebar
    ├── TaskCard.tsx   # Individual task display
    ├── TaskList.tsx   # Task list container
    ├── SettingsView.tsx
    ├── ProviderSettings.tsx
    ├── GeneralSettings.tsx
    ├── LocalInferenceSettings.tsx
    ├── AgentMcpSettings.tsx
    ├── StatusBar.tsx
    └── AboutView.tsx

python/                # Local OCR Python server
└── local_ocr_server.py

scripts/
└── afterPack.js       # Build post-processing (icon + codesign)
```

---

## MCP Client Configuration

### Claude Code / Claude Desktop

Copy the auto-generated config from **Settings → Agent/MCP** and paste into `.mcp.json` or `claude_desktop_config.json`.

### Cursor

Copy the config into `.cursor/mcp.json`.

### OpenCode / WorkBuddy / QCode

These tools support the standard `mcpServers` stdio format. Paste the auto-generated config into your MCP settings.

---

## Troubleshooting

### macOS: "OCRFlow is damaged and can't be opened"

This is macOS Gatekeeper blocking an unsigned app. Right-click the app → **Open** → click **Open**.

### MinerU: files always use Agent mode despite having a token

1. Go to Settings → Providers → MinerU Cloud
2. Enter your token and click **Test Connection**
3. Click **Save Settings**
4. Re-add your files

### Local OCR: "PaddleOCR not installed"

Your local OCR service does not have PaddleOCR installed. Install it with:

```bash
pip install paddleocr[all]
```

### Large PDF fails to process

For PDFs >200MB, local splitting is disabled to prevent memory issues. These files are submitted as a single chunk. Try reducing the file size or using MinerU Precision mode.

### MCP server can't find OCRFlow executable

Set the environment variable `OCRFLOW_COMMAND` to the full path of the OCRFlow executable.

### Network errors cause chunk failures without retry

Transient network errors are detected and do not trigger unnecessary page-size degradation. Click **Retry** on the failed task — only failed chunks are retried.

---

## License

MIT License — LIU HUAN

## Links

- GitHub: https://github.com/L-iuhuan/ocr_project
- Releases: https://github.com/L-iuhuan/ocr_project/releases
