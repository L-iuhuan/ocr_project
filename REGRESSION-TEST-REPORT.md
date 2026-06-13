# OCRFlow v1.2.0 发布前最终测试报告

> 测试日期：2026-06-13  
> 测试版本：`v1.2.0` (commit `2796664`)  
> 测试环境：Windows 11, Node.js 24.14.0, Electron 28.3.3  
> 备份分支：`backup-v1.2.0-before-stage2`

---

## 一、自动化测试结果总览（30 项全通过）

| 类别 | 项数 | 通过 | 失败 |
|------|------|------|------|
| TypeScript 类型检查 | 2 | 2 | 0 |
| CLI 边界测试 | 4 | 4 | 0 |
| CLI 本地 OCR | 3 | 3 | 0 |
| CLI MinerU Precision | 1 | 1 | 0 |
| 输出质量（NUL/CTRL/UTF-8） | 1 | 1 | 0 |
| MCP 协议（tools/list + parse） | 3 | 3 | 0 |
| MCP structuredContent | 1 | 1 | 0 |
| Vite 构建 | 4 | 4 | 0 |
| electron-builder NSIS | 1 | 1 | 0 |
| EXE 图标嵌入 | 1 | 1 | 0 |
| Python 资源 unpack | 1 | 1 | 0 |
| MCP 资源 unpack | 1 | 1 | 0 |
| 启动清理保守化 | 1 | 1 | 0 |
| Workspace 目录结构 | 1 | 1 | 0 |
| Build artifact 干净 | 2 | 2 | 0 |
| HTML MathJax | 1 | 1 | 0 |
| 版本号一致性 | 1 | 1 | 0 |
| **合计** | **30** | **30** | **0** |

---

## 二、架构/功能新增（Stage 1 + Stage 2）

### Stage 1：选择性重试 + 失败修复

| 功能 | 状态 |
|------|------|
| 缺失 chunk PDF 时按页段从原始文件重建，不整文件重跑 | ✅ |
| Partial 只重试失败 chunk，保留已完成 chunk | ✅ |
| 网络/TLS/下载错误不触发自动降级拆分 | ✅ |
| 成功后删除旧 `_partial` 输出 | ✅ |
| MinerU Precision/Agent 模式在 GUI 日志可见 | ✅ |

### Stage 2：任务工作区 + manifest.json

| 功能 | 状态 |
|------|------|
| 新增 `electron/pipeline/task-workspace.ts` | ✅ |
| Chunk PDF 写入 `_ocrflow_tmp/{jobId}/chunks/` | ✅ |
| OCR 结果写入 `_ocrflow_tmp/{jobId}/results/` | ✅ |
| `manifest.json` 持久化 chunk state、resultMd、provider、partialOutputs | ✅ |
| Manifest 原子写入（.tmp → rename） | ✅ |
| `retryTask` 从 manifest 恢复状态 | ✅ |
| `restoreTasks` 从 manifest 恢复（App 重启存活）| ✅ |
| 启动清理：只删 orphan workspace，不删活动任务 | ✅ |
| 任务完成/移除时 workspace 全清 | ✅ |
| 旧任务无 manifest 时降级兼容 | ✅ |

### 架构改进

| 改进 | 说明 |
|------|------|
| `splitter.ts` 支持可选 `jobId` + `outputDir` | 向后兼容，不传则走旧 `getTempDir()` |
| `buildTaskFromFile` 接受可选 `jobId` | 提前生成 jobId 以在 split 时写入 workspace |
| `generateJobId()` 在 add-files/headless-runner 中提前调用 | 无异步依赖 |
| `ensureChunkFile` 重建到 workspace chunks/ | chunk 缺失时恢复 |

---

## 三、本次累计 Bug 修复（20 项）

| # | 问题 | 状态 |
|---|------|------|
| 1 | MD NUL 字节被编辑器当二进制 | ✅ |
| 2 | 重试缺页 | ✅ |
| 3 | `_ocrflow_tmp` 空目录残留 | ✅ |
| 4 | MaxListenersExceeded 警告 | ✅ |
| 5 | 未完成 chunk 标记 done | ✅ |
| 6 | MinerU Precision→Agent 误报 | ✅ |
| 7 | 降级拆分 PDF 碎片泄漏 | ✅ |
| 8 | rcedit 下载失败→EXE 图标未嵌入 | ✅ |
| 9 | HTML 公式无 MathJax | ✅ |
| 10 | DOCX 公式残留 $ | ✅ |
| 11 | TaskCard hover 阴影过重 | ✅ |
| 12 | 最大化按钮线宽过细 | ✅ |
| 13 | 0 字节 PDF 误返回 pageCount=1 | ✅ |
| 14 | MCP fallback 绝对路径缺失 | ✅ |
| 15 | Agent/MCP UX 复杂 | ✅ |
| 16 | 示例路径暴露隐私 | ✅ |
| 17 | 版本号多处硬编码 | ✅ |
| 18 | localhost IPv6 导致本地 OCR ECONNREFUSED | ✅ |
| 19 | 自动降级对网络错误误触发 | ✅ |
| 20 | 重试整文件重跑 + 额度浪费 | ✅ |

---

## 四、手动测试清单

### A. Windows GUI

| 序号 | 测试项 | 操作 | 预期 |
|------|--------|------|------|
| W1 | MinerU Precision | 填 Token → 保存 → 拖入 PDF | 日志出现 `[MinerU] Precision 模式` |
| W2 | 默认输出格式 | 设置 → 只勾选 md → 保存 | 只生成 .md |
| W3 | Agent/MCP 页 | 设置 → Agent / MCP | 双按钮，Prompt + 手动配置均可用 |
| W4 | Prompt 复制 | 复制配置指令 → 粘贴 | 通用内容，含配置 JSON |
| W5 | MCP 配置复制 | 复制 MCP 配置 → 粘贴 | JSON 正确，含 ELECTRON_RUN_AS_NODE |
| W6 | EXE 图标 | 查看 `release/win-unpacked/OCRFlow.exe` | 图标正确 |
| W7 | TaskCard 悬浮 | 鼠标悬停 | 阴影轻微 |
| W8 | 最大化按钮 | 右上角 | 方框线宽正常 |
| W9 | HTML MathJax | 打开输出的 .html | 公式渲染 |
| W10 | DOCX 公式 | 打开 .docx | $ 符号已去除 |
| W11 | 本地 OCR (外部服务) | 端口 8080 → 拖 PDF | 直接连接不启动新服务 |
| W12 | NSIS 安装 | 双击 Setup exe | 可选路径 → 进度条 → 自动启动 |
| W13 | Partial + 重试 | PDF 处理 → 部分失败 → 点重试 | 只重试失败 chunk，日志提示 |
| W14 | App 重启恢复 | 处理中退出 → 重新打开 | 失败任务可重试，workspace 保留 |

### B. CLI

| 序号 | 测试项 | 命令 | 预期 |
|------|--------|------|------|
| C1 | 开发 CLI | `npm run parse -- "pdf路径" --json` | `ok:true` |
| C2 | 打包 CLI | `release\win-unpacked\OCRFlow.exe --headless parse ...` | `ok:true` |
| C3 | 指定 provider | `--providers mineru-cloud,paddleocr-cloud` | 按顺序 |
| C4 | 本地 OCR CLI | `--provider paddleocr-local` | 连接 8080 |

### C. MCP

| 序号 | 测试项 | 操作 | 预期 |
|------|--------|------|------|
| M1 | Agent 调用 | Claude Code 调用 `parse_documents` | 工具可发现，调用成功 |
| M2 | 打包态 MCP | 安装后复制 MCP 配置 | 工具可用 |
| M3 | structuredContent | 调用返回 | 含 structuredContent |

### D. macOS

| 序号 | 测试项 | 操作 | 预期 |
|------|--------|------|------|
| mac1 | App 打开 | 从 CI artifact 下载 DMG → 右键打开 | 红绿灯正常 |
| mac2 | CLI | `.../OCRFlow --headless parse ... --json` | `ok:true` |
| mac3 | MCP | 复制 MCP 配置 → 贴在 Mac 客户端 | Agent 可调用 |
| mac4 | Python 本地 OCR | 启用本地 OCR → 拖 PDF | Python 子进程正常 |

---

## 五、已知限制

| 限制 | 说明 |
|------|------|
| DOCX 公式 | 仅去 $ 包裹，未转 Word OMML |
| HTML MathJax 需联网 | 离线环境公式 LaTeX 原样 |
| macOS 未签名 | CI 构建 DMG 首次需右键打开 |
| MCP 并发 | 同一时刻仅一个解析任务（设计如此） |
| 本地 OCR 公式质量 | 取决于部署的模型能力，非 OCRFlow 控制 |

---

## 六、结论

- **自动回归**：30 项全部通过
- **Stage 2 新增**：任务工作区 + manifest 持久化
- **累计 Bug 修复**：20 项
- **需手动测试**：18 项（含 macOS 4 项）

当前版本通过所有自动化回归测试。请按"四、手动测试清单"逐项验证。
