# OCRFlow v1.2.0 发布前最终测试报告

> 测试日期：2026-06-13  
> 测试版本：`v1.2.0` (commit `5c11ec8`+)  
> 测试环境：Windows 11, Node.js 24.14.0, Electron 28.3.3

---

## 一、版本历史

| 版本 | 主要变更 |
|------|----------|
| v1.2.0 | macOS 支持、Headless CLI、MCP Server、NSIS 打包、图标修复、Agent/MCP 设置页 |
| v1.1.2 | 跨平台修复、macOS 构建 CI |
| v1.0.2 | 初始发布 |

---

## 二、自动化测试结果（30 项）

| 类别 | 项数 | 通过 | 说明 |
|------|------|------|------|
| TypeScript 类型检查 (main) | 1 | 1 | `tsc --noEmit -p tsconfig.json` |
| TypeScript 类型检查 (renderer) | 1 | 1 | `tsc --noEmit -p tsconfig.web.json` |
| Vite 构建 (renderer + electron) | 1 | 1 | `vite build` |
| MCP server bundle | 1 | 1 | `mcp-server.js` 产出 |
| electron-builder NSIS | 1 | 1 | `OCRFlow Setup 1.2.0.exe` + `win-unpacked` |
| EXE 图标嵌入 | 1 | 1 | rcedit afterPack hook |
| Python 资源 unpack | 1 | 1 | `app.asar.unpacked/python/` |
| MCP 资源 unpack | 1 | 1 | `app.asar.unpacked/dist-electron/mcp-server.js` |
| CLI help | 1 | 1 | `--help` 输出正确 |
| CLI 无路径 | 1 | 1 | 返回参数错误 |
| CLI 不存在文件 | 1 | 1 | `ok:false`, skipped 列出路径 |
| CLI 无效 provider | 1 | 1 | 参数校验报错 |
| CLI 单文件 OCR | 1 | 1 | MD 文件成功生成 |
| CLI 批量 OCR | 1 | 1 | 多文件同时处理 |
| CLI JSON 输出 | 1 | 1 | 纯 JSON（无 npm 横幅干扰） |
| 输出 MD 无 NUL 字节 | 1 | 1 | `sanitizeTextContent` 生效 |
| 输出 MD 无控制字符 | 1 | 1 | 同上 |
| 输出 MD UTF-8 有效 | 1 | 1 | 所有 MD 可正常解码 |
| `_ocrflow_tmp` 清理 (完整成功) | 1 | 1 | 完全成功时无残留 |
| `_ocrflow_tmp` 保留 (partial) | 1 | 1 | partial 时保留用于重试（设计如此） |
| MCP tools/list | 1 | 1 | `parse_documents` 可发现 |
| MCP parse_documents | 1 | 1 | 调用返回 `ok:true`, structuredContent |
| MCP 版本号 | 1 | 1 | `1.2.0`，从 package.json 动态读取 |
| MCP config 开发态 | 1 | 1 | `command: node` |
| MCP config 打包态 | 1 | 1 | `ELECTRON_RUN_AS_NODE=1` |
| Agent/MCP UI | 1 | 1 | 双按钮 UX + 参数速查表 + CLI 说明 |
| HTML MathJax | 1 | 1 | 公式渲染脚本注入 |
| 版本号一致性 | 1 | 1 | package.json / MCP / AboutView / StatusBar 同步 |
| PDF 碎片不泄漏 | 1 | 1 | 子分片写入 `getTempDir()` |
| 0 字节 PDF 拒绝 | 1 | 1 | `pageCount=0`，正确跳过 |

---

## 三、多角度架构审查结论

### 架构师视角
- 模块依赖单向无循环 ✅
- `TaskWorker` 内嵌 `BrowserWindow` 导入（emitQuotaUpdate），非纯逻辑类 —— 设计如此，headless 下 `persistTasks:false` 时 quota 广播无害（无窗口）
- `runTasksOnce` 回调覆盖模式在小概率永不触发时存在泄漏风险 —— 设计中，因 await spawn 永不返回时会挂起整个任务，此时 MCP socket 也会超时

### 测试专家视角
- 已修复：0 字节 PDF 误返回 pageCount=1 ✅
- 已修复：PDF 子分片泄漏 ✅
- 已修复：NUL 字节导致 MD "二进制" ✅
- 已修复：重试缺页 ✅
- 已知风险：超大 PDF (>200MB) 内存峰值 —— 已有 trailer 正则 fallback，实际极少遇到
- 已知风险：损坏 symlink 导致整目录跳过 —— 边界场景，暂不修

### macOS 专家视角
- `frame` / `titleBarStyle` 平台判断正确 ✅
- `python-bridge` ASAR unpack 路径解析正确 ✅
- `ocr.png` 作为 macOS 图标源正常 ✅
- Sharp 原生模块 electron-builder 自动重编译 ✅
- 建议：正式分发前完成 Developer ID 签名

### 小白用户视角
- 默认设置合理 ✅
- 错误提示均为中文 ✅
- 启动空态有引导文案 ✅
- Agent/MCP 页面提供"复制指令"一键 Prompt（无需懂 MCP） ✅
- 打包后无需安装 Node.js（`ELECTRON_RUN_AS_NODE`） ✅

### Agent/MCP 用户视角
- `tools/list` 返回标准 JSON Schema ✅
- `parse_documents` 支持 6 个参数，含 required/optional/default ✅
- 并发 guard 防重 ✅
- MCP 配置支持开发态/打包态自动切换 ✅
- OCRFlow 可执行文件路径解析三级 fallback ✅

---

## 四、输出质量实测

测试文件：`test-export.pdf`（财务公式 PDF）

```text
NUL=0 CTRL=0  ← 100% 纯净
```

部分输出内容预览：

```markdown
递延年金（Deferred Annuity）现值，设递延期 m，支付期 n：
$$ PV_{DA}=A\times(P/A,\;r,\;n)\times(P/F,\;r,\;m) $$

存货周转率（Inventory Turnover）：
$$ 存货周转率 =\frac{ 营业成本 COGS}{ 平均存货 Avg.Inventory} $$
```

公式正确、中文完整、MathJax 可渲染。

---

## 五、手动测试清单

以下需要在 GUI / macOS / 真机环境下验证。

### A. Windows GUI（必须）

| 序号 | 测试项 | 操作 | 预期 |
|------|--------|------|------|
| W1 | MinerU Precision | 填 Token → 保存 → 拖入 PDF | 终端出现 `[MinerU:Precision]` |
| W2 | 默认输出格式 | 设置 → 只勾选 md → 保存 → 拖 PDF | 只生成 .md |
| W3 | Agent/MCP 页 | 设置 → Agent/MCP | 双按钮 UX 正常，两个按钮都能复制 |
| W4 | Prompt 通用性 | 复制配置指令 → 粘贴 | 内容通用，适用多种 Agent |
| W5 | 手动配置 | 复制 MCP 配置 → 粘贴 | JSON 正确，含 `ELECTRON_RUN_AS_NODE` |
| W6 | 图标 | 查看 `release/win-unpacked/OCRFlow.exe` | 图标正确 |
| W7 | TaskCard 悬浮 | 鼠标悬停 | 阴影轻微，不刺眼 |
| W8 | 最大化按钮 | 右上角 | 方框线宽正常 |
| W9 | HTML 公式 | 打开输出的 .html | MathJax 渲染公式（需联网） |
| W10 | DOCX 公式 | 打开 .docx | $ 符号已去除 |
| W11 | 本地 OCR | 启用本地 OCR → 拖 PDF | Python 子进程启动正常 |
| W12 | NSIS 安装 | 双击 `OCRFlow Setup 1.2.0.exe` | 可选路径 → 进度条 → 自动启动 |

### B. CMD/CLI（必须）

| 序号 | 测试项 | 命令 | 预期 |
|------|--------|------|------|
| C1 | 开发 CLI | `npm run parse -- "pdf路径" --json` | `ok: true`，MD 生成 |
| C2 | 打包 CLI | `release\win-unpacked\OCRFlow.exe --headless parse "pdf路径" --json` | 同上 |
| C3 | 指定 provider | `--providers mineru-cloud,paddleocr-cloud` | 按顺序尝试 |
| C4 | JSON 纯净 | `--json 2>&1` | 仅输出 JSON，无横幅 |

### C. MCP（必须）

| 序号 | 测试项 | 操作 | 预期 |
|------|--------|------|------|
| M1 | Agent 调用 | Claude Code / Cursor 调用 `parse_documents` | 可发现工具，调用成功 |
| M2 | 打包态 MCP | 安装后点"复制 MCP 配置" → 粘贴到 `.mcp.json` | 工具可用 |
| M3 | 并发拒绝 | 同时发两个 `parse_documents` 调用 | 第二个返回 busy |

### D. macOS（需 Mac 真机 / 云 Mac）

| 序号 | 测试项 | 操作 | 预期 |
|------|--------|------|------|
| mac1 | App 打开 | 从 GitHub Actions artifact 下载 DMG → 右键打开 | 红绿灯可见，App 正常运行 |
| mac2 | 拖入 PDF | macOS App 内拖入 PDF | 正常处理，MD 输出 |
| mac3 | CLI | `OCRFlow --headless parse /path/to/test.pdf --json` | `ok: true` |
| mac4 | MCP | 复制 MCP 配置 → 贴在 Mac MCP 客户端 | Agent 可调用 |
| mac5 | Python 本地 OCR | 在 Mac 上启用本地 OCR | Python3 自动检测，子进程正常 |

---

## 六、已修复 Bug 清单（本版本累计 17 项）

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

---

## 七、已知限制

| 限制 | 说明 |
|------|------|
| DOCX 公式 | 仅去 $ 包裹，未转 Word OMML 公式对象 |
| HTML MathJax 需联网 | 离线环境公式保持 LaTeX 原样 |
| macOS 未签名 | CI 构建 DMG 首次需右键打开 |
| ollama / openai-compat 默认启用 | UI 层面不影响功能，后续可改默认关闭 |
| MCP 依赖绝对路径 | 软件移动位置需重新复制 MCP 配置 |

---

## 八、发版建议

1. **提交当前所有改动** → `git push`
2. **GitHub Releases** 上传：
   - `release/OCRFlow Setup 1.2.0.exe`（Windows NSIS 安装器）
   - `release/win-unpacked/` 压缩为 `OCRFlow-win-1.2.0.zip`（解压即用）
   - macOS DMG/ZIP（从 GitHub Actions artifact 下载）
3. **打 tag**：`git tag v1.2.0 && git push --tags`
4. **用户说明**：
   - Win：解压即用 或 运行安装器
   - Mac：右键 app 打开（首次）
   - MCP：打开软件 → 设置 → Agent/MCP → 复制配置
   - CLI：`OCRFlow.exe --headless parse "文件路径" --json`
