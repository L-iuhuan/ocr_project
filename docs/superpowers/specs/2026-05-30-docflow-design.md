# DocFlow — 多引擎文档批量处理工具 架构设计文档 (v1.0)

> 创建日期：2026-05-30 | 状态：设计审批中

---

## 1. 项目目标

一个 Electron + React + TypeScript + Tailwind CSS 的 Windows 桌面应用，让用户拖入 PDF/PPTX/图片文件（夹），批量通过多 Provider API 解析为 Markdown/JSON/HTML/DOCX 并保存到本地。

核心能力：多 Provider 自动路由、断点续传、任务控制（暂停/取消/重试）、大文件自动拆分。

---

## 2. 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 桌面壳 | Electron 28+ | 窗口管理、系统托盘 |
| 主进程 | TypeScript + Node.js | 文件 IO、网络请求、子进程管理 |
| 预加载 | TypeScript (preload.ts) | contextBridge 安全暴露 IPC API |
| 渲染进程 | React 18 + TypeScript + Tailwind CSS 3 | UI 界面 |
| 打包 | Vite | 渲染进程打包 |
| 构建 | electron-builder | 单文件 exe 输出 |
| 状态持久化 | JSON 文件 (docflow_tasks.json) | 断点续传，无数据库 |
| HTTP 客户端 | axios (主进程) | API 调用 |
| PDF 处理 | pdf-lib | 读取页数、拆分 PDF |
| 图片处理 | sharp | 压缩/降采样 |
| 文件哈希 | crypto (SHA256, 前 4MB) | 去重 |
| 本地 OCR | Python 子进程 (paddlex --serve) | 本地推理 sidecar |

---

## 3. 核心架构：三阶段流水线

所有 Provider 共用此三阶段框架：

```
Phase 1: 文档预处理
  扫描去重 → 识别类型/页数 → 根据 Provider 策略拆分 → 生成 chunk 列表

Phase 2: API 调用
  按优先级尝试 Provider → 配额耗尽自动切换 → 并行提交 chunk → 轮询 → 下载

Phase 3: 后处理
  内容校验 → 按 sequence 排序合并 → 输出格式化 → 清理临时 chunk
```

### 3.1 Phase 1 — 文档预处理

**输入：** 用户拖入的原始文件/文件夹路径列表  
**输出：** 每个文件的 chunks[] 数组，每个 chunk 是独立可提交的最小单元

**处理步骤：**
1. `scanner.ts` — 递归扫描文件夹，SHA256 前 4MB 去重，同名不同内容自动加 _1/_2 后缀
2. `preprocessor.ts` — 识别文件类型（pdf/pptx/image），获取页数/幻灯片数
3. `splitter.ts` — 根据当前选定 Provider 的限制，将超限文件拆分成合规 chunk

**忽略规则：**
- 支持：`.pdf`, `.png`, `.jpg`, `.jpeg`, `.jp2`, `.webp`, `.gif`, `.bmp`, `.pptx`
- `.ppt` → 弹窗提示"请用 PowerPoint 另存为 .pptx 后再处理"
- `.doc`, `.docx`, `.xls`, `.xlsx` → 忽略

### 3.2 Phase 2 — API 调用

**输入：** Phase 1 的 chunk 列表 + 用户选择的 Provider 优先级  
**输出：** 每个 chunk 的解析结果（raw JSON/Markdown 保存在临时目录）

**Provider 选择模式：**
- 全局模式：用户设定一个默认 Provider
- 配额不足时自动切换到下一个可用 Provider（按用户设定的优先级顺序）
- 如果两个 Cloud Provider 都失败 → 报错通知用户（**不自动 fallback 到本地 OCR**）
- 本地 OCR 仅在用户**主动选择**时启用

### 3.3 Phase 3 — 后处理

**输入：** 同一原始文件的所有 chunk 结果集合  
**输出：** 用户指定目录下的最终文档

**处理步骤：**
1. `validator.ts` — 内容完整性校验（非空检查、关键字段验证）
2. `merger.ts` — 按 chunk.sequence 排序后合并
   - 单 chunk：直接下载改名为原文件名.格式
   - 多 chunk：Markdown 用 `\n\n---\n\n` 分隔，JSON 用 content_list 拼接
3. `output-normalizer.ts` — 不同 Provider 输出 → 统一 {markdown, json, images, metadata} 结构
4. 同名冲突 → 加 _1 后缀
5. 合并后删除临时 chunk 文件

---

## 4. Provider 抽象层

### 4.1 IProvider 接口

```typescript
interface IProvider {
  readonly name: string;
  readonly type: ProviderType; // 'mineru-cloud' | 'paddleocr-cloud' | 'paddleocr-local'
  readonly limits: ProviderLimits;

  /** Phase 1: 返回该 Provider 的拆分策略 */
  getSplitStrategy(file: FileInfo): SplitStrategy;

  /** Phase 2: 上传文件 → 返回 task_id，订阅进度回调 */
  submit(filePath: string, onProgress: (pct: number) => void): Promise<string>;

  /** Phase 2: 轮询任务状态 */
  poll(taskId: string): Promise<TaskStatus>;

  /** Phase 2: 下载结果到本地临时路径 */
  download(taskId: string, destDir: string): Promise<ParsedOutput>;

  /** Phase 3: 将 Provider 原生输出归一化为统一格式 */
  normalize(raw: RawOutput): ParsedOutput;

  /** 健康检查：检测 Provider 是否可用 */
  healthCheck(): Promise<ProviderHealth>;
}
```

### 4.2 三个 Provider 实现

**Mineru Cloud (mineru-cloud.provider.ts)**
- 接口：`/api/v4/file-urls/batch` (Precision) / `/api/v1/agent/parse/file` (Agent)
- Agent 模式免 Token，免费，IP 限速
- Precision 模式需 Token，输出格式丰富

**PaddleOCR-VL Cloud (paddleocr-cloud.provider.ts)**
- 接口：`POST /layout-parsing` (Baidu AI Studio)
- 需 API Key → Token
- 返回 markdown + JSON（30 天有效 URL）

**Local PaddleOCR (paddleocr-local.provider.ts)**
- 通过 Python 子进程启动 paddlex --serve
- HTTP 调用 `localhost:{port}/layout-parsing`
- 无页数/大小硬限制（取决于硬件）

### 4.3 Provider 路由逻辑

```
选择 Provider → Provider 可用?
  ├─ 可用 → 按该 Provider 策略拆分 chunk → 提交 chunk
  │         ├─ 成功 → 保存结果
  │         ├─ 配额耗尽/Token 失效 → 标记 Provider 不可用 → 切换到下一个 Provider
  │         │         → 重新按新 Provider 策略拆分（chunk 大小可能不同）
  │         │         → 重新提交
  │         └─ 所有 Cloud Provider 都不可用 → 报错通知用户（不 fallback 本地）
  └─ 不可用 → 尝试下一个 Provider
```

---

## 5. 按 Provider 的精确拆分策略

### 5.1 MinerU Cloud

| 模式 | 页数上限 | 大小上限 | Token | 拆分规则 |
|------|---------|---------|-------|---------|
| Agent (Flash) | ≤ 20 页 | ≤ 10 MB | 不需要 | 按 20 页/chunk 拆分 |
| Precision | ≤ 200 页 | ≤ 200 MB | 需要 | 按 200 页/chunk 拆分 |

- 文件 > 200MB（Precision）或 > 10MB（Agent）→ 先 sharp 压缩
- 支持格式：PDF, 图片, DOCX, PPTX, XLSX

### 5.2 Baidu PaddleOCR-VL-1.6

| 限制项 | 值 |
|--------|-----|
| 单文件页数 | ≤ 100 页 |
| 日配额 | **20,000 页/天** |
| PDF 大小 | ≤ 50 MB (base64) |
| 图片大小 | ≤ 10 MB，最长边 ≤ 4096px |
| 流式文档 | ≤ 50 MB |
| Token | 需要 API Key + Secret Key |
| 拆分规则 | 按 **100 页/chunk** 拆分 |
| QPS | 提交 2 QPS，查询 5 QPS |

### 5.3 Local PaddleOCR

| 限制项 | 值 |
|--------|-----|
| 页数 | 无硬限制（取决于 GPU 显存） |
| 大小 | 无硬限制 |
| 默认页数限制 | 10 页（需通过配置解锁：max_num_input_imgs: null） |
| 拆分规则 | 不拆分（仅对大文件做 sharp 压缩预处理） |

---

## 6. 本地 OCR 集成方案

### 6.1 架构

```
Electron Main Process (Node.js)
  └── python-bridge.ts
       ├── 启动时检测：python --version, python -c "import paddleocr"
       ├── 寻找可用端口 (51987-52987)
       ├── 启动子进程：python local_ocr_server.py --port {port}
       ├── 轮询 /health 等待就绪 (最长 120s)
       └── 退出时：SIGTERM → 等 5s → SIGKILL
```

### 6.2 Python sidecar 脚本 (local_ocr_server.py)

- 使用 paddlex 或 paddleocr 的 API
- 启动本地 HTTP 服务（可通过 FastAPI 封装）
- 或用官方方案：`paddlex --serve --pipeline layout_parsing --port {port}`
- 推荐使用官方 `paddlex --serve`，简化维护

### 6.3 端口策略

- 动态分配，避免与用户其他服务冲突
- 默认扫描范围 51987-52987
- 用户可手动指定端口
- 如果用户已有 PaddleOCR 服务在运行，提供"连接已有服务"选项

### 6.4 环境检测

```typescript
interface PythonEnv {
  pythonInstalled: boolean;
  pythonVersion: string;        // "3.10.0"
  paddleocrInstalled: boolean;
  hasGPU: boolean;
  gpuMemoryMB: number;
}
```

### 6.5 风险与对策

| 风险 | 对策 |
|------|------|
| Python 未安装 | 启动弹窗，指引下载 Python 3.8+ |
| 模型未下载（首次 ~500MB） | 检测 ~/.paddlex 目录，提示用户等待 |
| GPU 显存不足 | 自动降级 CPU 模式 |
| Python 进程崩溃 | watchdog 心跳检测，30s 无响应自动重启 |
| 默认 10 页限制 | Python 脚本自动写入配置 max_num_input_imgs: null |

---

## 7. UI 布局设计

```
┌─────────────────────────────────────────────────────┐
│  Menu Bar [DocFlow]    [设置]                    │
├─────────────────────────────────────────────────────┤
│  设置面板（可折叠）                                    │
│  ┌─ API 设置 ────────────────────────────────────┐  │
│  │  Provider 优先级（可拖拽排序）                    │  │
│  │  [1. MinerU Cloud] [2. Baidu PaddleOCR]        │  │
│  │  Base URL: [________]  Token: [******] [测试]  │  │
│  ├─ 输出设置 ────────────────────────────────────┤  │
│  │  输出目录: [________] [浏览]                     │  │
│  │  输出格式: ☑MD ☑JSON ☐HTML ☐DOCX              │  │
│  │  并发数: [1-5▼]                                │  │
│  └─────────────────────────────────────────────┘  │
├───────────────────────────┬─────────────────────────┤
│  左侧 60%                  │  右侧 40%               │
│  ┌─ 拖拽区域 ────────────┐ │  ┌─ 实时日志 ──────┐  │
│  │ 拖拽文件/文件夹到此处   │ │  │ [12:30:15] 开始..│  │
│  └─────────────────────┘ │  │ [12:30:16] 文件.. │  │
│  ┌─ 任务队列表格 ────────┐ │  │ [12:30:20] API.. │  │
│  │ 文件名 │状态│进度│页数│ │  │ [12:30:25] 完成.. │  │
│  │ a.pdf │🟢  │45% │150 │ │  └─────────────────┘  │
│  │ b.pdf │🔵  │  - │ 20 │ │                        │
│  └────────────────────────┘ │                        │
├───────────────────────────┴─────────────────────────┤
│  底部状态栏                                          │
│  ████████████░░░░░░░░ 总进度 65%                      │
│  待处理: 3 │ 处理中: 2 │ 已完成: 10 │ 失败: 1        │
└─────────────────────────────────────────────────────┘
```

### 7.1 组件树

```
App.tsx
├── SettingsPanel.tsx       // 可折叠设置面板
│   ├── ProviderSelector.tsx // Provider 优先级排序
│   ├── TokenInput.tsx       // Base URL + Token 输入
│   ├── OutputDirPicker.tsx  // 输出目录选择
│   ├── FormatSelector.tsx   // 多选输出格式
│   └── ConcurrencySlider.tsx // 并发数 1-5
├── DragDropZone.tsx         // 拖拽上传区域
├── TaskTable.tsx            // 任务队列表格
│   ├── 列：文件名、状态（彩色标签）、进度%、页数、格式、操作（取消/重试）
│   └── 行：虚拟滚动（大量任务时性能优化）
├── LogPanel.tsx             // 实时日志（自动滚底）
└── StatusBar.tsx            // 总进度条 + 统计数值
```

### 7.2 状态标签颜色

| 状态 | 颜色 | 含义 |
|------|------|------|
| pending | 灰色 (#9CA3AF) | 排队中 |
| preprocessing | 青色 (#06B6D4) | 预处理中 |
| uploading | 蓝色小点动画 | 上传中 |
| running | 蓝色 (#3B82F6) | 解析中 |
| downloading | 蓝色小点动画 | 下载结果中 |
| merging | 紫色 (#8B5CF6) | 合并中 |
| done | 绿色 (#10B981) | 完成 |
| failed | 红色 (#EF4444) | 失败，显示错误信息 |
| cancelled | 橙色 (#F59E0B) | 已取消 |
| paused | 黄色 (#EAB308) | 已暂停 |

操作按钮显隐规则：
- pending/paused → 显示「取消」
- failed → 显示「重试」
- running/uploading → 显示「取消」
- done/cancelled → 无操作按钮（或显示「重新处理」）

---

## 8. IPC 接口定义 (preload.ts)

```typescript
interface ElectronAPI {
  // === 任务管理 ===
  addFiles(paths: string[]): Promise<void>;
  getTasks(): Promise<Task[]>;
  pauseQueue(): void;
  resumeQueue(): void;
  cancelTask(jobId: string): void;
  retryTask(jobId: string): void;

  // === 设置 ===
  selectOutputDir(): Promise<string>;
  saveSettings(settings: AppSettings): void;
  loadSettings(): Promise<AppSettings>;

  // === Provider 管理 ===
  getProviderStatus(): Promise<ProviderStatus[]>;
  testProviderConnection(providerType: ProviderType, credentials: ProviderCredentials): Promise<boolean>;
  setProviderPriority(providers: ProviderType[]): void;

  // === 事件监听（主进程 → 渲染进程） ===
  onTasksUpdate(callback: (tasks: Task[]) => void): () => void;  // 返回 unsubscribe
  onLog(callback: (message: LogEntry) => void): () => void;
  onProgress(callback: (progress: GlobalProgress) => void): () => void;
  onProviderStatusChange(callback: (status: ProviderStatus[]) => void): () => void;
}
```

### 8.1 核心类型定义

```typescript
interface Task {
  jobId: string;
  originalName: string;
  sourcePaths: string[];
  fileType: 'pdf' | 'pptx' | 'image';
  pageCount: number;
  apiType: 'AGENT' | 'PRECISION' | 'PaddleOCR-VL' | 'LOCAL';
  outputFormats: ('md' | 'json' | 'html' | 'docx')[];
  outputDir: string;
  state: TaskState;
  progress: number;               // 0-100
  currentChunk?: number;
  totalChunks?: number;
  chunks: Chunk[];
  errorCode?: string;
  errorMsg?: string;
  retryCount: number;
  providerUsed?: ProviderType;    // 实际使用的 Provider
}

interface Chunk {
  chunkSequence: number;
  chunkPath: string;              // temp/ 下路径
  taskId?: string;                // API 返回的 task_id
  chunkState: 'pending' | 'uploading' | 'running' | 'downloading' | 'done' | 'failed';
  resultUrl?: string;
  progress: number;               // 0-100
  errorCode?: string;
}

interface AppSettings {
  providers: {
    [ProviderType.MineruCloud]: { baseUrl: string; token: string; };
    [ProviderType.PaddleOCRCloud]: { apiKey: string; secretKey: string; };
    [ProviderType.PaddleOCRLocal]: { enabled: boolean; port: number; pythonPath: string; };
  };
  providerPriority: ProviderType[];
  outputDir: string;
  outputFormats: ('md' | 'json' | 'html' | 'docx')[];
  concurrency: number;            // 1-5
  theme: 'light' | 'dark';
}
```

---

## 9. 数据流

```
用户拖入文件
  → IPC: addFiles([paths])
    → scanner.ts 扫描去重
    → preprocessor.ts 分析文件
    → splitter.ts 生成 chunk 列表
    → state-manager.ts 持久化到 docflow_tasks.json
    → IPC: onTasksUpdate → 渲染进程更新 TaskTable

用户开始处理（或自动开始）
  → task-worker.ts 从队列取任务
    → 按并发信号量（1-5）并行提交
    → provider-router.ts 选择 Provider
      → 尝试 Provider-1 (如 MinerU Cloud)
        → mineru-cloud.provider.ts
          → submit(chunk) → api-client.ts 上传
          → poll(taskId) → 轮询进度
          → download(taskId) → 保存临时结果
        → 若失败/配额耗尽 → 标记 Provider 不可用
        → 换 Provider-2 (如 Baidu PaddleOCR-VL)
        → 重新按新 Provider 策略拆分 chunk
        → 重复提交...轮询...下载流程
      → 所有 Cloud Provider 不可用 → 报错
    → 所有 chunk 完成
      → merger.ts 合并
      → output-normalizer.ts 归一化
      → validator.ts 校验
      → 输出到用户目录
      → 清理 temp/
    → IPC: onProgress → 更新底部状态栏
    → IPC: onLog → 追加日志
```

---

## 10. 状态持久化 (state-manager.ts)

文件位置：`app.getPath('userData')/docflow_tasks.json`

```json
{
  "version": "1.0",
  "lastSaved": "2026-05-30T12:00:00Z",
  "providerStatus": {
    "mineru-cloud": { "available": true, "quotaExhausted": false, "lastError": null },
    "paddleocr-cloud": { "available": true, "quotaExhausted": false, "lastError": null },
    "paddleocr-local": { "available": false, "reason": "Python not installed" }
  },
  "tasks": [
    {
      "jobId": "uuid",
      "originalName": "report.pdf",
      "sourcePaths": ["C:/Docs/report.pdf"],
      "fileType": "pdf",
      "pageCount": 350,
      "apiType": "PRECISION",
      "outputFormats": ["md", "json"],
      "outputDir": "C:/MinerU_Output",
      "state": "running",
      "progress": 45,
      "chunks": [
        {
          "chunkSequence": 0,
          "chunkPath": "temp/uuid_chunk_0.pdf",
          "taskId": "batch_uuid_xxx",
          "chunkState": "running",
          "resultUrl": null,
          "progress": 60,
          "errorCode": null
        },
        {
          "chunkSequence": 1,
          "chunkPath": "temp/uuid_chunk_1.pdf",
          "taskId": null,
          "chunkState": "pending",
          "progress": 0
        }
      ],
      "providerUsed": "mineru-cloud",
      "errorCode": null,
      "errorMsg": null,
      "retryCount": 0
    }
  ]
}
```

**恢复规则：**
- `chunk_state` = pending/uploading/running + chunk 文件存在 → 继续轮询
- 文件丢失但有 task_id → 直接轮询 task_id
- 无 task_id → 重新提交
- 任务完成/失败/取消 → 从 JSON 移除

---

## 11. 项目目录结构

```
D:\Files\projects\docflow\
├── electron/                         # 主进程 (TypeScript)
│   ├── main.ts                       # 入口：窗口创建、IPC 注册
│   ├── preload.ts                    # contextBridge 暴露 API
│   │
│   ├── pipeline/                     # 三阶段流水线
│   │   ├── scanner.ts                # Phase 1a：文件扫描、去重、SHA256
│   │   ├── preprocessor.ts           # Phase 1b：页数识别、类型分析
│   │   ├── splitter.ts               # Phase 1c：按 Provider 策略拆分
│   │   ├── merger.ts                 # Phase 3a：chunk 合并
│   │   ├── validator.ts              # Phase 3b：内容完整性校验
│   │   └── output-normalizer.ts      # Phase 3c：输出格式归一化
│   │
│   ├── providers/                    # Provider 抽象 + 实现
│   │   ├── i-provider.ts             # IProvider 接口定义
│   │   ├── provider-router.ts        # 自动路由 + 配额感知切换
│   │   ├── provider-registry.ts      # Provider 注册 + 拆分策略映射
│   │   ├── mineru-cloud.ts           # MinerU Cloud 实现
│   │   ├── paddleocr-cloud.ts        # Baidu PaddleOCR-VL Cloud 实现
│   │   └── paddleocr-local.ts        # 本地 Python 子进程桥接
│   │
│   ├── state-manager.ts              # 任务持久化 JSON, 断点续传
│   ├── task-worker.ts                # 任务执行控制器 (并发信号量)
│   ├── api-client.ts                 # HTTP 客户端封装 (axios)
│   └── python-bridge.ts              # Python 子进程生命周期管理
│
├── python/                           # Python sidecar（用户本地 OCR）
│   ├── local_ocr_server.py           # FastAPI 服务: /parse, /health
│   └── requirements.txt              # paddlepaddle, paddleocr[all], fastapi
│
├── src/                              # 渲染进程 (React)
│   ├── App.tsx                       # 主布局 (左右分栏)
│   ├── components/
│   │   ├── TaskTable.tsx             # 任务队列表格
│   │   ├── DragDropZone.tsx          # 拖拽上传区域
│   │   ├── SettingsPanel.tsx         # 可折叠设置面板
│   │   ├── ProviderSelector.tsx      # Provider 优先级排序
│   │   ├── LogPanel.tsx              # 实时日志
│   │   └── StatusBar.tsx             # 底部状态栏
│   ├── store/                        # React Context 状态管理
│   └── types/                        # TypeScript 类型定义
│
├── package.json
├── tsconfig.json                     # 主进程 TS 配置
├── tsconfig.web.json                 # 渲染进程 TS 配置
├── vite.config.ts
├── electron-builder.yml              # 打包配置 → release/*.exe
├── tailwind.config.js
└── postcss.config.js
```

---

## 12. 开发与打包

- **开发命令：** `npm run dev`（同时启动 Vite dev server + Electron）
- **打包命令：** `npm run build` → 输出到 `release/` 目录
- `package.json` 中 `"main": "dist-electron/main.js"`
- electron-builder 配置输出单文件 exe

---

## 13. 错误处理与边界情况

### 13.1 网络异常

| 异常 | 处理 |
|------|------|
| 请求超时 | 指数退避重试，最多 5 次 |
| 429 限流 | 等待 30 秒后重试 |
| 网络断开 | 暂停队列，检测到网络恢复后继续 |
| DNS 解析失败 | 退避重试，3 次失败后标记 Provider 不可用 |

### 13.2 API 错误码

| 错误码 | 来源 | 含义 | 处理 |
|--------|------|------|------|
| A0202/A0211 | MinerU | Token 无效/过期 | 标记 Provider 不可用，通知用户更新 Token |
| -60005 | MinerU | 文件过大 | 标记当前 chunk 失败（压缩后再试），不重试所有 chunk |
| -60006 | MinerU | 页数过多 | 检查拆分逻辑是否出 bug，标记失败 |
| -60018 | MinerU | 日配额用完 | 标记 Provider quota_exhausted，切换 |
| -60009 | MinerU | 队列满 | 指数退避重试 3 次 |
| -60010 | MinerU | 提取失败 | 指数退避重试 3 次 |
| 403 | Baidu | Token 无效 | 标记 Provider 不可用 |
| 413 | Baidu | 请求体过大 | 降低 chunk 大小/压缩 |
| 429 | Baidu | 日配额耗尽（20,000 页） | 标记 Provider quota_exhausted |
| 503 | Baidu | 请求过多 | 等待后重试 |
| 504 | Baidu | 网关超时 | 指数退避重试 |

### 13.3 文件系统异常

| 异常 | 处理 |
|------|------|
| 输出目录不可写 | 弹窗提示选择新目录 |
| 磁盘空间不足 | 弹窗提示，暂停队列，等待用户确认 |
| temp/ 目录残留 | 启动时清理上次残留 temp/ |
| 同名文件冲突 | 自动加 _1/_2 后缀 |

---

## 14. 本地页数计数器

每个 Provider 独立统计当日已处理的页数，用于实时了解 API 配额使用情况。

### 14.1 数据结构

```typescript
interface PageCountRecord {
  date: string;                    // "2026-05-30"
  provider: ProviderType;
  pagesProcessed: number;          // 当日已成功处理的页数
  pagesFailed: number;             // 当日失败的页数（不计入配额但计入统计）
}

interface ProviderQuotaInfo {
  provider: ProviderType;
  dailyLimit: number;              // 日配额上限，-1 表示无限制
  usedToday: number;               // 今日已用
  failedToday: number;             // 今日失败
  remaining: number;               // 剩余配额，-1 表示无限制
  percentUsed: number;             // 使用百分比 0-100
  lastResetDate: string;           // 上次重置日期（日配额次日 00:00 重置）
}
```

### 14.2 计数规则

| Provider | 日配额 | 计费单位 | 递增时机 |
|----------|--------|---------|---------|
| MinerU Agent | 2000 页/天 (IP) | 传入 API 的页数 | 任务成功完成时 +pageCount |
| MinerU Precision | Token 配额 | 传入 API 的页数 | 任务成功完成时 +pageCount |
| Baidu PaddleOCR-VL | 20,000 页/天 | API 返回的实际处理页数 | 下载结果后 +actualProcessedPages |
| Local PaddleOCR | 无限制 | — | 仅统计，不限制 |

### 14.3 持久化

计数器保存到 `docflow_counters.json`，放在 `app.getPath('userData')` 下：

```json
{
  "2026-05-30": {
    "mineru-cloud": { "pagesProcessed": 350, "pagesFailed": 20 },
    "paddleocr-cloud": { "pagesProcessed": 1200, "pagesFailed": 5 },
    "paddleocr-local": { "pagesProcessed": 80, "pagesFailed": 0 }
  }
}
```

- 当日 23:59:59 后自动归档，次日从 0 开始
- 历史记录保留最近 30 天（按需可扩展）
- 失败页数单独统计，不计入配额消耗

### 14.4 UI 展示

底部状态栏新增「配额」模块：

```
┌─────────────────────────────────────────────────────────────┐
│ ████████████░░░░░░ 总进度 65%                                │
│ 待处理:3 | 处理中:2 | 已完成:10 | 失败:1                     │
│ ☁️ MinerU: 350/∞ 页 | 🤖 Baidu: 1200/20000 页 (6%)          │
│ 🖥️ 本地: 80 页 (无限制)                                     │
└─────────────────────────────────────────────────────────────┘
```

设置面板新增「配额面板」卡片，展示每个 Provider 的详细计数和历史日趋势。

### 14.5 IPC 接口扩展

```typescript
interface ElectronAPI {
  // 新增
  getProviderQuotas(): Promise<ProviderQuotaInfo[]>;
  getPageCountHistory(days: number): Promise<PageCountRecord[]>;
  resetProviderCounter(provider: ProviderType): void;  // 手动重置
}
```

---

## 16. 线程安全

- 所有网络请求和文件 IO 均在**主进程**执行
- 渲染进程绝不直接操作文件或网络
- 前端仅通过 `electronAPI` 与主进程交互
- 并发由主进程信号量控制
- React 状态通过 `onTasksUpdate` 事件增量更新，避免全量刷新表格

---

## 17. 审批记录

| 日期 | 决策 | 状态 |
|------|------|------|
| 2026-05-30 | 确认三阶段流水线架构 | ✅ |
| 2026-05-30 | 确认 Provider 选择模式：全局 + 自动切换 | ✅ |
| 2026-05-30 | 确认拆分策略：不拒绝文件，按 Provider 限制拆分 | ✅ |
| 2026-05-30 | 确认本地 OCR 不进 fallback 链 | ✅ |
| 2026-05-30 | 确认 MinerU 限制：Agent 20页/10MB, Precision 200页/200MB | ✅ |
| 2026-05-30 | 确认 Baidu PaddleOCR-VL-1.6 限制：100页, 20000页/天 | ✅ |
| 2026-05-30 | 确认文件格式：不再排除任何格式，统一接受 | ✅ |
| 2026-05-30 | 确认 UI 设计系统：Flat Design + Fira 字体 + 青蓝双主题 | ✅ |
| 2026-05-30 | 确认项目名称：DocFlow | ✅ |
| 2026-05-30 | 新增：本地页数计数器，按 Provider 分离统计 | ✅ |
