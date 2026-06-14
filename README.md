# OCRFlow

多引擎 OCR 文档批量处理工具。支持 PDF、Office 文档和图片的智能识别与结构化输出，可调用 MinerU Cloud、PaddleOCR Cloud 或本地 OCR 引擎。

**跨平台** — Windows（安装器 + 解压即用）和 macOS（Apple Silicon）。  
**多引擎** — MinerU Precision/Agent、百度 PaddleOCR-VL Cloud、本地 OCR 服务。  
**Agent 就绪** — 标准 MCP 工具 `parse_documents`，AI Agent 可直接调用。  
**命令行** — 无需打开 GUI，CLI 批量 OCR，适合自动化和 CI 场景。

---

## 一、安装

### Windows

| 格式 | 用法 |
|------|------|
| **NSIS 安装器** | 双击 `OCRFlow Setup 1.2.0.exe`，选择安装路径，自动创建桌面和开始菜单快捷方式。 |
| **解压即用** | 解压 `OCRFlow-win-1.2.0.zip` 到任意目录，双击 `OCRFlow.exe`。 |

### macOS（Apple Silicon）

1. 下载 `OCRFlow-1.2.0-arm64-mac.zip` 并解压
2. 将 `OCRFlow.app` 拖入 `/Applications`
3. 首次启动：**右键点击** App → **打开** → 对话框点**打开**

### 从源码构建

```bash
git clone https://github.com/L-iuhuan/ocr_project.git
cd ocr_project
npm install
npm run dev          # 开发模式
npm run build        # 生产构建（Windows）
```

**要求**：Node.js 18+。Python 3.8+ 仅在需要本地 OCR 引擎时需要。

---

## 二、支持的文件格式与输入限制

### 输入格式

| 类别 | 格式 | 说明 |
|------|------|------|
| PDF | `.pdf` | 核心格式，支持多页拆分 |
| Office | `.pptx` `.ppt` `.docx` `.doc` `.xlsx` | 通过文件大小估算页数 |
| 图片 | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.tif` `.tiff` `.jp2` | 单页处理 |
| 其他 | `.txt` `.wps` `.ofd` | 文本和国产文档格式 |

### 文件大小限制

| 条件 | 限制 |
|------|------|
| 输入文件最大值 | 无硬性限制（建议 ≤500MB） |
| MinerU Precision 单文件 | ≤200MB |
| MinerU Agent 单文件 | ≤10MB |
| PaddleOCR Cloud 单文件 | ≤50MB |
| 本地 OCR 单文件 | ≤500MB（超过会拒绝） |
| 本地 PDF 拆分阈值 | ≤200MB（超过不拆分，整文件提交） |
| Preprocessor 全量解析 | ≤200MB（超过用 trailer 估算页数，不读取全文） |

### 文件类型校验

PDF 和图片文件会校验文件头魔数（magic bytes），扩展名与实际内容不符的文件会被自动跳过，防止恶意伪装的非文档文件进入处理管线。Office/WPS/OFD 等容器格式通过扩展名判断。

---

## 三、全流程处理说明

### 文件→输出 的完整流程

```
输入文件/文件夹
  ↓
1. 扫描（Scanner）
  - 递归扫描文件夹
  - 去重（SHA-256 + 文件大小）
  - 魔数校验（PDF/图片）
  ↓
2. 预处理（Preprocessor）
  - PDF：pdf-lib 精确数页（≤200MB），超大文件用 trailer 估算
  - Office/图片：估算页数
  ↓
3. 服务商路由（Provider Router）
  - 按设置优先级选择服务商
  - 跳过不可用/配额耗尽/不支持格式的服务商
  ↓
4. 拆分（Splitter）
  - PDF 按页数拆分成多个 chunk（默认 20 页/块，可调）
  - 超大 PDF（>200MB）不拆分，整文件提交
  - 图片直接作为一个 chunk
  ↓
5. 提交处理（TaskWorker）
  - 每个 chunk 上传到服务商 API
  - 轮询等待识别完成
  - 下载结果（Markdown / ZIP）
  - 解码图片（base64 / 远程 URL）
  ↓
6. 合并（Merger）
  - 多 chunk 结果按页码顺序拼接
  - 图片收集到 images/ 目录
  - Markdown 中图片路径重写
  - 保存最终输出（.md / .html / .json / .docx）
  ↓
7. 清理
  - 成功：删除临时文件和 workspace
  - 部分失败：保留临时文件，方便重试
  - 任务移除：清理 workspace
```

### 后处理细节

| 步骤 | 说明 |
|------|------|
| Markdown 拼接 | 多 chunk 用 `---` 分隔，单 chunk 去掉包裹注释 |
| 图片收集 | 从每个 chunk 的 result 目录收集所有图片，统一复制到输出目录的 `images/` 子目录 |
| 图片路径重写 | Markdown 中的 `![alt](path)` 和 `<img src="path">` 重写为统一的相对路径 |
| HTML 输出 | 注入 MathJax CDN，渲染 `$...$` 和 `$$...$$` LaTeX 公式 |
| DOCX 输出 | 通过 OOXML 组装，支持标题/表格/图片/列表/代码块，去除 `$` 包裹符 |
| NUL 字节清洗 | 服务商返回内容中的空字节和控制字符自动过滤，避免编辑器误判为二进制文件 |
| JSON 输出 | 包含原始文件名、服务商、分块状态、页数等元信息 + 完整 Markdown |

### 临时文件管理

每个任务有独立的工作区目录：

```text
{outputDir}/_ocrflow_tmp/{jobId}/
├── manifest.json       # chunk 状态、result.md 路径、服务商记录
├── chunks/             # 拆分后的 PDF 分块
└── results/            # 每个 chunk 的 OCR 结果 + 图片
```

- 任务成功 → workspace 自动删除
- 部分失败 → workspace 保留，供下次重试复用已完成 chunk
- App 重启 → 只清理不属于当前任务列表的 orphan workspace，活动任务的 workspace 保留
- chunk 文件缺失 → 按页段从原始 PDF 重建对应分块

### 错误处理与重试

| 错误类型 | 处理方式 |
|----------|----------|
| 网络/TLS/下载错误 | **不自动降级拆分**（网络问题不靠拆小解决），日志提示"疑似网络问题"，可直接重试 |
| 文件过大错误 | 自动降级拆分（200→100→50→20→10→5→2→1 页），三次机会 |
| 连续两次 chunk 失败 | 自动切换到下一个可用服务商 |
| 重试操作 | 仅重试失败 chunk，已完成 chunk 不重复提交 |

---

## 四、各引擎详细说明

### MinerU Cloud

| 模式 | Token | 文件限制 | 每块页数 | 说明 |
|------|-------|----------|----------|------|
| **Precision** | 需要 | ≤200MB | ≤200 页 | 高质量，支持 PDF/PPTX/DOCX/XLSX/图片。每日 1000 页免费额度。 |
| **Agent** | 不需要 | ≤10MB | ≤20 页 | 免登录，适合小文件和快速试用。 |

**实现细节**：
- Precision 模式走 MinerU API v4（`/file-urls/batch` → PUT 上传 → `/extract-results/batch` 轮询 → ZIP 下载）
- Agent 模式走 MinerU API v1（`/agent/parse/file` → OSS PUT → `/agent/parse` 轮询 → Markdown 下载）
- 配额耗尽时（API 返回 `-60018`）自动从 Precision 降级到 Agent
- 日志仅记录 batch_id、state、code，不记录签名 URL

### PaddleOCR Cloud

| 属性 | 值 |
|------|------|
| Token | 需要 |
| 文件限制 | ≤50MB |
| 每块页数 | ≤100 页 |
| 每日额度 | 20,000 页 |
| 支持格式 | PDF/PPTX/PPT/DOC/DOCX/TXT/WPS/OFD/图片 |

**实现细节**：调用 `https://paddleocr.aistudio-app.com/api/v2/ocr`，multipart/form-data 上传，JSONL 结果下载。

### 本地 OCR 引擎

| 场景 | 说明 |
|------|------|
| 外部服务已运行 | 配置端口，OCRFlow 自动连接，不启动内置服务 |
| 外部服务未运行 | 使用配置的 Python 路径启动内置 `python/local_ocr_server.py` |
| 需要 PaddleOCR | 内置服务依赖 `pip install paddleocr[all]` |
| 接受任意兼容服务 | 任何提供 `/layout-parsing` POST 和 `/health` GET 的服务均可 |
| 结果格式兼容 | 自动适配 `layoutParsingResults[].markdown.text` / `prunedResult.parsing_res_list` / `choices[0].message.content` 等常见格式 |

---

## 五、CLI 命令行使用

无需打开 GUI 即可处理文档：

```bash
# 单文件
OCRFlow.exe --headless parse "D:\docs\report.pdf" --out "D:\ocr-out"

# 批量文件夹
OCRFlow.exe --headless parse "D:\docs\2026" --providers mineru-cloud,paddleocr-cloud --json

# 开发环境
npm run parse -- "D:\docs\report.pdf" --provider mineru-cloud --json
```

### 完整参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--out <目录>` | string | 输出目录（默认使用 GUI 设置） |
| `--provider <名称>` | enum | 指定单个引擎：`mineru-cloud` / `paddleocr-cloud` / `paddleocr-local` |
| `--providers <列表>` | string | 引擎 fallback 顺序，逗号分隔，如 `mineru-cloud,paddleocr-cloud` |
| `--concurrency <N>` | number | 并发任务数 1-8（默认使用 GUI 设置） |
| `--chunk-size <N>` | number | 每块页数（默认使用 GUI 设置） |
| `--json` | flag | 输出纯净 JSON 摘要（方便脚本/Agent 解析） |
| `--help` | flag | 打印帮助信息 |

### CLI 行为说明

- CLI 会复用 GUI 保存的所有设置（Token、输出目录、文件名模板等）
- `--json` 模式下 `console.log` 被抑制，输出是纯 JSON
- `--provider` 和 `--providers` 互斥，不要同时使用
- 文件路径建议使用正斜杠或双反斜杠
- 退出码：0=全部成功，1=有失败，2=参数错误/无文件，3=无可用服务商

---

## 六、MCP Server（AI Agent 集成）

OCRFlow 内置标准 MCP stdio server，提供 `parse_documents` 工具。兼容所有支持 MCP stdio 协议的 Agent（Claude Code、Claude Desktop、Cursor、OpenCode、WorkBuddy、QCode 等）。

### 配置方式

打开 OCRFlow → **设置 → Agent/MCP**，页面提供两种配置方式：

1. **交给 Agent 自动配置（推荐）**：复制一段 Prompt，发给任意 AI Agent，它会自动完成 MCP 配置
2. **自己手动配置**：复制 JSON，粘贴到 MCP 客户端的配置文件中

### 工具参数（parse_documents）

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `paths` | string[] | 是 | — | 文件或文件夹的绝对路径列表 |
| `outputDir` | string | 否 | GUI 输出目录 | 本次处理的输出目录 |
| `providers` | string[] | 否 | GUI 优先级 | 服务商 fallback 顺序 |
| `provider` | string | 否 | auto | 单个服务商：`auto` / `mineru-cloud` / `paddleocr-cloud` |
| `concurrency` | number | 否 | GUI 设置 | 并发数 1-8 |
| `chunkSize` | number | 否 | GUI 设置 | 每块页数 |

### 返回格式

```json
{
  "ok": true,
  "total": 2,
  "completed": 2,
  "failed": 0,
  "skipped": [],
  "tasks": [
    {
      "jobId": "...",
      "originalName": "report.pdf",
      "state": "done",
      "outputDir": "D:\\ocr-output"
    }
  ]
}
```

同时返回 `structuredContent` 字段，兼容支持结构化输出的新 MCP 客户端。

### MCP 运行时说明

- **开发环境**：配置使用系统安装的 Node.js，命令为 `node`
- **打包后**：配置使用 OCRFlow 可执行文件本身 + `ELECTRON_RUN_AS_NODE=1`，**无需额外安装 Node.js**
- **并发**：同一 MCP Server 同时只处理一个请求（后续请求返回 busy 错误）
- **超时**：单个处理最长 1 小时，超时先 SIGTERM 再 SIGKILL
- **路径校验**：MCP Server 对输入路径做 `realpath` 解析和扩展名校验，防止注入和跨目录
- **环境变量隔离**：MCP Server 只向子进程传递 `PATH`/`HOME`/`TMPDIR` 等安全变量，不泄露敏感 Token
- **软件移动后**：MCP 配置中的绝对路径会失效，需要重新在设置页复制

---

## 七、设置项完整参考

### 服务商

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| MinerU → API Token | 空 | Precision 模式 Token。留空仅使用 Agent 模式。 |
| MinerU → 接口地址 | `https://mineru.net/api/v4` | API 地址 |
| PaddleOCR → Access Token | 空 | PaddleOCR 控制台获取的 Token |
| 本地 OCR → 启用 | 关闭 | 启用本地 OCR 引擎 |
| 本地 OCR → 端口 | 51987 | 服务监听端口。该端口已有服务时直接连接。 |
| 本地 OCR → Python 路径 | `python3`(macOS) / `python`(Win) | 用于自动启动内置服务 |

### 基本设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 输出格式 | Markdown | 可多选：md、html、json、docx |
| 输出目录 | `文档/OCRFlow_Output` | 处理结果的保存路径 |
| 文件命名模板 | `{date}/{name}` | `{name}`=原名 `{date}`=YYYY-MM-DD `{time}`=HH-MM-SS `{timestamp}`=YYYYMMDDHHMMSS |
| 并发数 | 2 | 同时处理的任务数（1-8） |
| 每块页数 | 20 | PDF 分块粒度 |

### 文件处理

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 保留图片 | 开启 | OCR 结果中的图片保存到 `images/` 目录 |
| 图片输出目录 | 跟随输出目录 `images/` | 自定义图片路径 |
| 自动解压 ZIP | 开启 | 自动解压服务商返回的 ZIP 包 |
| 处理完删除临时文件 | 开启 | 成功后清理临时分块文件 |

---

## 八、构建

### 开发运行

```bash
npm install
npm run dev          # Vite 开发服务器 + Electron
```

### 生产构建（Windows）

```bash
npm run build        # 生成 NSIS 安装器 + win-unpacked
```

构建产物：
- `release/OCRFlow Setup 1.2.0.exe` — NSIS 安装器（可选安装路径、创建桌面快捷方式）
- `release/win-unpacked/OCRFlow.exe` — 免安装，解压即用

### macOS 构建

通过 GitHub Actions CI 自动构建。也可在 macOS 上本地构建：

```bash
npm ci
npm run build
# .app 位于 release/mac*/OCRFlow.app
# 用 ditto 打包以保留 symlink：
ditto -c -k --sequesterRsrc --keepParent OCRFlow.app OCRFlow-1.2.0-mac-arm64.zip
```

---

## 九、项目结构

```text
electron/                    # Electron 主进程
├── main.ts                  # 应用生命周期、窗口
├── preload.ts               # contextBridge
├── ipc-handlers.ts          # IPC 处理
├── task-worker.ts           # OCR 任务队列、分块、重试
├── state-manager.ts         # JSON 持久化
├── python-bridge.ts         # Python 子进程管理
├── headless-args.ts         # CLI 参数
├── headless-runner.ts       # CLI 批量 OCR
├── mcp-server.ts            # MCP stdio server
├── pipeline/
│   ├── scanner.ts           # 文件发现 + 去重 + 魔数校验
│   ├── preprocessor.ts      # 页数分析
│   ├── splitter.ts          # PDF 拆分
│   ├── merger.ts            # 结果合并 + HTML/DOCX
│   ├── validator.ts         # 合并前校验
│   └── task-workspace.ts    # 任务工作区 manifest
└── providers/               # 服务商实现
    ├── mineru-cloud.ts
    ├── paddleocr-cloud.ts
    ├── paddleocr-local.ts
    ├── provider-registry.ts
    └── provider-router.ts

src/                         # React 渲染进程
├── App.tsx                  # 根组件
├── index.css                # 主题 + 布局
├── constants.ts             # 共享常量
├── store/AppContext.tsx     # useReducer 全局状态
├── types/index.ts           # 类型定义
└── components/              # UI 组件
```

---

## 十、常见问题

### macOS "OCRFlow 已损坏，无法打开"

右键 App → 打开 → 打开。这是 macOS Gatekeeper 对未签名 App 的正常反应。

### MinerU 填了 Token 却走 Agent 模式

1. 填 Token → 测试连接 → 保存设置
2. **重新添加文件**（已在列表里的旧任务不会自动切换）

### 本地 OCR "PaddleOCR 未安装"

```bash
pip install paddleocr[all]
```

或在设置里指向已运行的外部 OCR 服务地址和端口。

### 大 PDF 处理失败

超过 200MB 的 PDF 本地拆分会被禁用。使用 MinerU Precision 模式（≤200MB/文件）或缩减文件大小。

### MCP 找不到 OCRFlow

设置环境变量 `OCRFLOW_COMMAND` 为可执行文件的完整路径。

### 网络错误导致分块失败

直接点重试即可。网络错误不会触发自动降级拆分，只重试失败分块。

---

## 许可证

MIT License — LIU HUAN

## 链接

- GitHub：https://github.com/L-iuhuan/ocr_project
- Releases：https://github.com/L-iuhuan/ocr_project/releases
