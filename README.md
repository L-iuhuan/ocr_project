# OCRFlow

多引擎 OCR 文档批量处理工具。支持 PDF、Office 文档和图片的智能识别与结构化输出，可调用 MinerU Cloud、PaddleOCR Cloud 或本地 OCR 引擎。

**跨平台** — Windows（安装器 + 解压即用）+ macOS（Apple Silicon）。  
**多引擎** — MinerU Precision/Agent、百度 PaddleOCR-VL Cloud、本地 OCR 服务。  
**Agent 就绪** — 标准 MCP 工具 `parse_documents`，AI Agent 可直接调用。  
**命令行** — 无需打开 GUI，CLI 批量 OCR，适合自动化和 CI 场景。

---

## 安装与使用

### Windows

| 格式 | 用法 |
|------|------|
| **NSIS 安装器**（`OCRFlow Setup 1.2.0.exe`） | 双击运行，选择安装路径，自动创建桌面和开始菜单快捷方式。 |
| **解压即用**（`OCRFlow-win-1.2.0.zip`） | 解压到任意目录，双击 `OCRFlow.exe`，无需安装。 |

### macOS（Apple Silicon）

1. 下载 `OCRFlow-1.2.0-arm64-mac.zip`
2. 解压 → 把 `OCRFlow.app` 拖到 `/Applications`
3. 首次启动：**右键点击** App → **打开** → 对话框点**打开**
4. 之后正常双击即可

> **为什么首次要右键打开？**  
> App 使用了 ad-hoc 签名（没有 Apple Developer 证书），macOS Gatekeeper 需要用户额外确认一次。注册 Apple Developer 之后可以做到双击即开。

### 从源码构建

```bash
git clone https://github.com/L-iuhuan/ocr_project.git
cd ocr_project
npm install
npm run dev          # 开发模式
npm run build        # 生产构建
```

**运行要求**：Node.js 18+。Python 3.8+ 仅在需要使用本地 OCR 引擎时需要。

---

## 快速上手

### 第一步：配置 OCR 服务商

打开 OCRFlow，进入**设置 → 服务商**。最简单的用法是使用 **MinerU Agent 模式**，不需要任何 Token，直接就能处理小文件（≤10MB、≤20 页）。如果需要更好的识别质量或处理大文件，可以配置 MinerU Token 或 PaddleOCR Token。

### 第二步：添加文件

把文件或文件夹拖入软件窗口，或者通过工具栏按钮添加。

### 第三步：开始处理

点击启动按钮。OCRFlow 会把大 PDF 拆分成页段分块，依次提交给选定的服务商，等待识别结果，下载后合并输出。

支持输入格式：PDF、PPTX、DOCX、XLSX、PNG、JPG、JPEG、WebP、GIF、BMP、TIFF、TXT、WPS、OFD

输出格式：Markdown、JSON、HTML、DOCX（可在设置中多选）

---

## 核心功能

### 多引擎 OCR

| 引擎 | 类型 | 说明 |
|------|------|------|
| **MinerU Cloud** | 云端 API | Precision 模式（需 Token，≤200MB/文件，≤200 页/块）或 Agent 模式（免 Token，≤10MB/文件，≤20 页/块）。支持 PDF、PPTX、DOCX、XLSX、图片。 |
| **PaddleOCR Cloud** | 云端 API | 百度 PaddleOCR-VL 云 API，支持包括 WPS、OFD 在内的多种格式。 |
| **本地 OCR 引擎** | 本地服务 | 对接任意提供 `/layout-parsing` POST 接口的本地 OCR 服务（PaddleOCR、MinerU 等均可）。OCRFlow 也可在配置好 Python 路径后自动启动内置的简易 OCR 服务。 |

各引擎按设定优先级依次尝试，某个引擎失败时自动 fallback 到下一个。

### 命令行（CLI）

无需打开 GUI，通过命令行完成批量 OCR：

```bash
# 单文件
OCRFlow.exe --headless parse "D:\docs\report.pdf" --out "D:\ocr-output"

# 批量文件夹
OCRFlow.exe --headless parse "D:\docs\2026" --providers mineru-cloud,paddleocr-cloud --json

# 开发环境
npm run parse -- "D:\docs\report.pdf" --provider mineru-cloud --json
```

支持的参数：

| 参数 | 说明 |
|------|------|
| `--out <目录>` | 输出目录（默认使用 GUI 设置） |
| `--provider <名称>` | 单个引擎：`mineru-cloud`、`paddleocr-cloud`、`paddleocr-local` |
| `--providers <列表>` | 引擎 fallback 顺序，逗号分隔 |
| `--concurrency <N>` | 并发数（1-8） |
| `--chunk-size <N>` | 每块页数 |
| `--json` | 输出机器可读 JSON 摘要 |
| `--help` | 打印帮助信息 |

### MCP Server（AI Agent 集成）

OCRFlow 提供一个标准 MCP stdio server，包含 `parse_documents` 工具。所有兼容 MCP 协议的 AI Agent（Claude Code、Claude Desktop、Cursor、OpenCode、WorkBuddy、QCode 等）都可直接调用。

**配置方式**：打开 OCRFlow → **设置 → Agent/MCP** → 复制自动生成的配置指令或 JSON。

**工具调用格式**：

```json
{
  "paths": ["C:/Users/你的用户名/Documents/report.pdf"],
  "outputDir": "C:/Users/你的用户名/Desktop/ocr-output",
  "providers": ["mineru-cloud", "paddleocr-cloud"]
}
```

除 `paths` 外所有参数均可选。OCR 引擎的 Token 等凭据复用 GUI 设置。

**打包后无需安装 Node.js**：OCRFlow 的可执行文件自带 Electron 内嵌的 Node.js 运行时，配置中的 `ELECTRON_RUN_AS_NODE=1` 会让 MCP 客户端直接以 OCRFlow.exe 作为 Node 来运行 MCP server。

### 图片处理

- OCR 结果中的图片会被提取并保存到输出目录下的 `images/` 文件夹。
- Markdown 中的图片引用会自动重写，指向正确的相对路径。
- 在设置中关闭 `keepImages` 可以跳过图片收集。
- 没有图片时不会创建 `images/` 目录。

### 任务工作区与重试

每个任务拥有独立的工作区：

```text
outputDir/_ocrflow_tmp/{jobId}/
├── manifest.json       # chunk 状态记录
├── chunks/             # 拆分后的 chunk PDF
└── results/            # OCR 识别结果
```

- 某个 chunk 失败时（网络错误、下载超时等），仅重试失败的分块，已完成的部分不会被重复处理。
- 临时文件丢失时，会按页段范围从原始 PDF 重建对应分块。
- 任务完成或被移除后，工作区自动清理。
- 应用重启后不会误删还在重试范围内的任务工作区。

### 输出文件命名

文件名遵循可配置模板（设置 → 基本设置）：

| 变量 | 含义 |
|------|------|
| `{name}` | 原始文件名（不含扩展名） |
| `{date}` | `YYYY-MM-DD` |
| `{time}` | `HH-MM-SS` |
| `{timestamp}` | `YYYYMMDDHHMMSS` |

默认模板：`{date}/{name}`（按日期分子目录存放）。

### 主题与界面

- 深色 / 浅色 / 跟随系统三种主题模式，搭配多套配色方案（薰衣草紫、冰蓝、薄荷绿、琥珀金）。
- Windows 上使用定制无框标题栏，macOS 上保留原生红绿灯。
- 实时日志面板，支持关键词搜索和级别筛选。
- 任务卡片展示每个分块的进度、服务商、耗时、文件大小。

---

## 设置项参考

### 服务商

| 设置项 | 说明 |
|--------|------|
| MinerU Cloud → API Token | Precision 模式 Token。留空仅使用 Agent 模式。 |
| MinerU Cloud → 接口地址 | API 地址（默认 `https://mineru.net/api/v4`）。 |
| PaddleOCR Cloud → Access Token | PaddleOCR 控制台获取的 Token。必填。 |
| 本地 OCR → 启用 | 启用本地 OCR 引擎。 |
| 本地 OCR → 服务端口 | 本地 OCR 服务监听端口（默认 51987）。如果该端口已有运行中的服务，OCRFlow 会直接连接。 |
| 本地 OCR → Python 路径 | Python 可执行文件路径（macOS 默认 `python3`，Windows 默认 `python`）。外部服务不可用时，会尝试用此路径启动内置简易 OCR 服务。 |

### 基本设置

| 设置项 | 说明 |
|--------|------|
| 输出格式 | Markdown / JSON / HTML / DOCX（可多选）。 |
| 输出目录 | 处理结果的保存路径。 |
| 文件命名模板 | 见上方输出文件命名。 |
| 并发数 | 同时处理的任务数（1-8），默认 2。 |
| 每块页数 | PDF 分块粒度，默认 20 页。 |
| 自动开始 | 添加文件后立即开始处理。 |

### 文件处理

| 设置项 | 说明 |
|--------|------|
| 保留图片 | 从 OCR 结果中提取并保存图片（默认开启）。 |
| 图片输出目录 | 自定义图片存放路径（默认跟随输出目录的 `images/`）。 |
| 自动解压 ZIP | 自动解压服务商返回的 ZIP 包。 |
| 处理完删除临时文件 | 成功处理后清理临时分块文件。部分失败时会保留临时数据以供重试。 |

---

## 构建

### 环境要求

- Node.js 18+
- npm
- Python 3.8+（可选，仅本地 OCR 需要 `paddleocr[all]`）

### 开发运行

```bash
npm install
npm run dev          # Vite 开发服务器 + Electron
```

### 生产构建

```bash
npm run build        # Windows: NSIS 安装器 + win-unpacked 目录
```

构建产物在 `release/` 目录：
- `OCRFlow Setup 1.2.0.exe` — NSIS 安装器
- `win-unpacked/OCRFlow.exe` — 解压即用，无需安装

macOS 构建通过 GitHub Actions 自动完成，产物可在 Actions 页面或 Releases 页面下载。

---

## 项目结构

```text
electron/                    # Electron 主进程
├── main.ts                  # 应用生命周期、窗口创建
├── preload.ts               # 渲染进程 contextBridge
├── ipc-handlers.ts          # IPC 处理（设置、文件、服务商）
├── task-worker.ts           # OCR 任务队列、分块处理、重试
├── state-manager.ts         # JSON 持久化（任务、设置、计数器）
├── python-bridge.ts         # Python 子进程管理
├── headless-args.ts         # CLI 参数解析
├── headless-runner.ts       # CLI 批量 OCR 编排
├── mcp-server.ts            # MCP stdio server
├── pipeline/                # 处理管线
│   ├── scanner.ts           # 文件发现与去重
│   ├── preprocessor.ts      # 页数分析
│   ├── splitter.ts          # PDF 拆分
│   ├── merger.ts            # 结果合并、HTML/DOCX 生成
│   ├── validator.ts         # 合并前校验
│   └── task-workspace.ts    # 任务工作区 manifest 管理
└── providers/               # OCR 服务商实现
    ├── mineru-cloud.ts
    ├── paddleocr-cloud.ts
    ├── paddleocr-local.ts
    ├── provider-registry.ts
    └── provider-router.ts

src/                         # React 渲染进程
├── main.tsx                 # 入口
├── App.tsx                  # 根组件
├── index.css                # 主题与布局样式
├── store/AppContext.tsx     # 全局状态
├── types/index.ts           # 类型定义
├── hooks/useTheme.ts        # 主题切换
└── components/              # UI 组件

python/                      # 本地 OCR Python 服务
scripts/
└── afterPack.js             # 构建后处理（图标嵌入 + 签名）
```

---

## MCP 客户端配置

### Claude Code / Claude Desktop

在 OCRFlow 的 **设置 → Agent/MCP** 中复制自动生成的配置，粘贴到 `.mcp.json` 或 `claude_desktop_config.json`。

### Cursor

将配置粘贴到 `.cursor/mcp.json`。

### OpenCode / WorkBuddy / QCode

这些工具支持标准 `mcpServers` stdio 格式，直接粘贴即可。

### 手动配置（开发环境）

```json
{
  "mcpServers": {
    "ocrflow": {
      "command": "node",
      "args": ["D:\\Files\\projects\\docflow\\dist-electron\\mcp-server.js"]
    }
  }
}
```

---

## 常见问题

### macOS 提示"OCRFlow 已损坏，无法打开"

这是 macOS Gatekeeper 拦截未签名 App 的表现。右键点击 App → **打开** → **打开** 即可。

### MinerU 明明填了 Token 却总是走 Agent 模式

1. 进入设置 → 服务商 → MinerU Cloud
2. 填入 Token 后点击**测试连接**
3. 测试通过后点击**保存设置**
4. 重新添加文件

### 本地 OCR 提示"PaddleOCR 未安装"

本地 OCR 服务没有安装 PaddleOCR。执行：

```bash
pip install paddleocr[all]
```

或者，如果你有在某个端口上运行的外部 OCR 服务，直接在设置里配置对应端口即可，OCRFlow 会自动连接。

### 大 PDF 处理失败

超过 200MB 的 PDF，本地拆分会被禁用以避免内存问题，文件会作为一个整体提交。如果服务商也拒绝处理，建议缩减 PDF 大小或使用 MinerU Precision 模式。

### MCP 服务器找不到 OCRFlow 可执行文件

设置环境变量 `OCRFLOW_COMMAND` 为可执行文件的完整路径：

```bash
# Windows
set OCRFLOW_COMMAND=D:\apps\OCRFlow\OCRFlow.exe
# macOS
export OCRFLOW_COMMAND=/Applications/OCRFlow.app/Contents/MacOS/OCRFlow
```

### 分块因网络问题失败

网络/TLS/下载类错误会被自动检测，不会触发自动降级拆分。直接在失败任务上点**重试**即可，只会重试失败的分块，已完成的分块不会重复处理。

---

## 许可证

MIT License — LIU HUAN

## 链接

- 代码仓库：https://github.com/L-iuhuan/ocr_project
- 下载页面：https://github.com/L-iuhuan/ocr_project/releases
