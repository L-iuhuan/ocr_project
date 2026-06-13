# OCRFlow 端到端回归测试报告

> 测试日期：2026-06-13
> 测试版本：`f21e119` (Agent/MCP UX redesign + temp leak fix)
> 测试环境：Windows 11, Node.js 24.14.0, Electron 28.3.3

---

## 一、自动化测试结果总览

| 类别 | 项数 | 通过 | 失败 |
|------|------|------|------|
| CLI 边界 | 4 | 4 | 0 |
| CLI OCR 功能 | 5 | 5 | 0 |
| 输出质量 | 6 | 6 | 0 |
| MCP 协议 | 4 | 4 | 0 |
| TypeScript | 2 | 2 | 0 |
| Vite 构建 | 4 | 4 | 0 |
| **合计** | **25** | **25** | **0** |

---

## 二、CI 自动化验证

| 平台 | 状态 | 覆盖 |
|------|------|------|
| Windows (本地) | PASS | tsc + vite + electron-builder portable exe |
| macOS (GitHub Actions) | 待触发 | tsc + vite + electron-builder dmg/zip |

---

## 三、本次修复的 Bug（完整清单）

| # | Bug | 根因 | 修复方式 |
|---|-----|------|----------|
| 1 | **MD 文件被编辑器提示二进制** | MinerU 返回内容含 `\x00` NUL 字节 | `writeMergedOutputs` 前调用 `sanitizeTextContent` 过滤 |
| 2 | **重试任务缺页** | partial 输出后清理了临时文件，重试只重试失败 chunk | partial 时保留 temp，完整成功后再清理 |
| 3 | **`_ocrflow_tmp` 空目录残留** | `rmSync` 缺 `recursive: true` | 改为 `recursive: true` |
| 4 | **AbortSignal MaxListenersWarning** | 多 chunk 高并发下 listener 超限 | `setMaxListeners(100)` |
| 5 | **未完成 chunk 但标记 done** | 降级拆分失败后 chunk 状态遗漏 | merge 前检测 unfinishedChunks 不变式 |
| 6 | **MinerU Precision 下载失败误报 Agent** | Precision 下载失败后 fallback 到 Agent 下载逻辑 | 标记 precisionTaskIds，不再误 fallback |
| 7 | **自动降级拆分后 PDF 碎片泄漏** | `splitOneChunk` / `resplitRemainingChunks` 在原始文件目录创建 `_dN.pdf`，`cleanupTempFiles` 只清理 temp 目录 | 子分片写入 `getTempDir()` |
| 8 | **最大化按钮线宽过细** | CSS `1.5px` | 改为 `2px` |
| 9 | **TaskCard hover 阴影过重** | 复用全局 `var(--shadow)` | 独立 `6px 18px`，14% opacity |
| 10 | **HTML 公式不渲染** | 无 MathJax | HTML 注入 MathJax CDN |
| 11 | **DOCX 公式带 `$`** | 未 strip | `stripFormatMarkers` / `inlineToDocxRuns` 去除 |
| 12 | **Agent/MCP 页面 UX 混乱** | 风格不一致、信息过载、无引导 | 重新设计：双按钮（Prompt 自动配置 / 手动复制）、参数速查表、隐私安全示例 |
| 13 | **示例路径暴露真实文件系统** | 示例用开发者本地路径 | 全部换用 `C:/Users/你的用户名/...` 占位符 |
| 14 | **小白需装 Node.js 才能用 MCP** | 原配置 `command: "node"` | packaged 用 `ELECTRON_RUN_AS_NODE` + OCRFlow.exe，无需安装 Node.js |
| 15 | **MCP 配置无移动提示** | 用户不知路径变更后果 | 复制按钮旁提示"移动位置需重新复制" |

---

## 四、历史输出修复状态

`REGRESSION-TEST-REPORT.md` 记录了所有扫描过的 MD/HTML 输出质量。

---

## 五、手动测试清单

以下需要在 GUI / Mac 上验证。**自动化覆盖不到的操作项。**

### 必须手动操作的

| 序号 | 测试项 | 操作步骤 | 预期结果 |
|------|--------|----------|----------|
| M1 | **GUI MinerU Precision** | 打开 OCRFlow GUI → 设置 → 服务商 → 填 Token → 保存 → 拖入 PDF | 终端日志出现 `[MinerU:Precision]` 字样，MD 按预期生成 |
| M2 | **默认输出格式** | 设置 → 基本设置 → 取消多余格式，留 Markdown → 保存 → 拖入 PDF | 只生成 `.md` |
| M3 | **Agent/MCP 双按钮 UX** | 设置 → Agent / MCP | 看到两个编号区域：①复制配置指令（Prompt 给 Agent）+ ②自己手动配置；参数速查表风格一致；示例路径为通用占位符（无真实路径） |
| M4 | **Prompt 复制内容** | 点击「复制配置指令」→ 粘贴到文本编辑器 | 内容为一整段可以丢给任意 AI Agent 的 Prompt，附带当前 MCP 配置 JSON |
| M5 | **手动配置复制内容** | 点击「复制 MCP 配置」→ 粘贴验证 | 开发态含 `"command": "node"`；打包态含 `OCRFlow.exe` + `ELECTRON_RUN_AS_NODE` |
| M6 | **MCP 端到端** | 用 M3/M5 的配置在 Claude Code 中调用 `parse_documents` | 工具发现、调用、`.md` 成功生成 |

### 建议手动验证

| 序号 | 测试项 | 操作步骤 | 预期结果 |
|------|--------|----------|----------|
| S1 | **重试不丢页** | 拖入 PDF → 如有失败点"重试" | 重试后 `.md` 含完整页 |
| S2 | **PDF 碎片不泄漏** | 处理会触发拆分的 PDF → 任务完成后检查原始文件目录 | 无 `_d*.pdf` 残留 |
| S3 | **TaskCard 悬浮阴影** | 鼠标悬停 | 轻阴影，不刺眼 |
| S4 | **最大化线宽** | 看右上角最大化按钮 | 方框线正常，不细 |

### macOS 验证（需 Mac 真机 / 云 Mac）

| 序号 | 测试项 | 操作步骤 | 预期结果 |
|------|--------|----------|----------|
| mac1 | **App 打开** | 从 CI artifact 下载 DMG → 右键 → 打开 | 正常启动、红绿灯可见、无 Windows 三按钮 |
| mac2 | **macOS CLI** | 终端执行 `OCRFlow.app/.../OCRFlow --headless parse ... --json` | `ok: true`，MD 生成 |
| mac3 | **macOS MCP 配置** | 打开 App → 设置 → Agent / MCP → 复制配置 → 在 Mac 上配 `.mcp.json` | Agent 可发现并调用 `parse_documents` |
| mac4 | **本地 OCR (Python)** | 启用本地 OCR → 拖入 PDF | Python 子进程正常启动 |

---

## 六、Node.js / MCP 运行时说明

打包后可执行文件中，Electron 框架内嵌了 Node.js 运行时。设置 `ELECTRON_RUN_AS_NODE=1` 后，Electron 充当 Node.js，执行 MCP server 脚本。用户无需单独安装 Node.js。

### 适用场景

| 场景 | MCP 运行时 | 说明 |
|------|-----------|------|
| 开发态 (`npm run dev`) | `node`（系统安装的 Node.js） | 本地开发调试 |
| 打包 unpacked (`win-unpacked/OCRFlow.exe`) | `OCRFlow.exe` + `ELECTRON_RUN_AS_NODE=1` | 稳定，推荐分发 |
| 打包 portable (单 exe) | 同上 | 部分 electron-builder 版本可能对 `ELECTRON_RUN_AS_NODE` 支持不一致，如遇问题可改用 unpacked 版本 |

---

## 七、已知限制

| 限制 | 说明 |
|------|------|
| DOCX 公式 | 仅去除 `$` 包裹，未转 Word OMML 公式对象 |
| HTML MathJax 需联网 | 离线环境公式保持 `$...$` 原样 |
| macOS 未签名 | CI 构建 DMG 需右键打开；正式分发需 Apple Developer ID |
| Windows portable exe 与 MCP | 单 exe 的 `ELECTRON_RUN_AS_NODE` 可能不稳定，推荐 `win-unpacked` 分发 |
| MCP 并发 | 同一时刻仅一个解析任务（设计如此） |

---

## 八、结论

- **自动回归**：25 项全部通过
- **历史 Bug 修复**：15 项
- **新发现 Bug**：0 项
- **需手动测试**：10 项（含 macOS 4 项）
