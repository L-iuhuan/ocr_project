# OCRFlow 端到端回归测试报告

> 测试日期：2026-06-13
> 测试版本：`31e97aa` (Sanitize + Agent/MCP tab + temp leak fix)
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
| 12 | **Agent/MCP 无独立设置入口** | 混在 About 页 | 独立 `Agent / MCP` 设置页签 |
| 13 | **MCP 配置无小白方案** | 需 Node.js | packaged 使用 `ELECTRON_RUN_AS_NODE`，无需装 Node |
| 14 | **CLI 无说明文档** | 未在 UI 中暴露 | Agent/MCP 页添加命令行用法 |
| 15 | **MCP 配置无移动提示** | 用户不知路径变更后果 | 复制按钮旁提示"移动位置需重新复制" |

---

## 四、历史输出 NUL 字节扫描

对 `D:\Files\projects\test\` 下所有已生成的 `.md` 文件扫描：

| 文件 | NUL 字节 | 控制字符 | 状态 |
|------|----------|----------|------|
| test-export_processed.md | 0 | 0 | PASS |
| 分析框架扩展路线图_processed.md | **1** | **1** | **旧版 MIP 输出（新代码已过滤）** |
| 其他所有已生成 MD | 0 | 0 | PASS |

> 注意：`分析框架扩展路线图_processed.md` 来自旧版代码生成。新版 `sanitizeTextContent` 已确保后续输出无 NUL/控制字符。

---

## 五、手动测试清单

以下需要你在 GUI / Mac 上验证。

### 1. 必须验证

| 序号 | 测试项 | 操作步骤 | 预期结果 |
|------|--------|----------|----------|
| M1 | **GUI MinerU Precision 模式** | GUI → 设置 → 服务商 → 确认 MinerU Token 已填并保存 → 拖入 `分析框架扩展路线图.pdf` | 终端日志出现 `[MinerU:Precision]`（非 Agent），输出 `.md` / `.html` / `.json` / `.docx`（取决于设置勾选的格式），18 页完整 |
| M2 | **输出格式默认 md** | GUI → 设置 → 基本设置 → 只保留 Markdown 勾选 → 保存 → 拖入 PDF | 只生成 `.md` |
| M3 | **Agent/MCP 设置页** | GUI → 设置 → Agent / MCP | 页签风格与其他设置页一致；含 MCP 工具参数表格、CLI 用法示例、MCP 配置复制按钮；点击"复制 MCP 配置"后粘贴验证 |
| M4 | **MCP 配置可用性** | 将复制的 MCP 配置贴入 `.mcp.json` → 重启 Claude Code / 打开 `/mcp` → 让 AI 调用 `parse_documents` 解析一个 PDF | `parse_documents` 工具可发现，调用成功，`.md` 生成 |
| M5 | **HTML 公式渲染** | 打开某个已处理文件的 `.html` | MathJax 渲染 `$...$` 为公式（需联网） |

### 2. 建议验证

| 序号 | 测试项 | 操作步骤 | 预期结果 |
|------|--------|----------|----------|
| S1 | **重试后缺页不再出现** | GUI 拖入一个 PDF → 观察处理 → 如有失败，点击"重试" | 重试完成后 `.md` 含完整页数，无缺页 |
| S2 | **PDF 碎片不泄漏** | 处理一个 PDF（可能触发降级拆分） → 任务完成后检查原始文件所在目录 | 无 `_d0.pdf` / `_sub0.pdf` 残留 |
| S3 | **TaskCard 悬浮** | 鼠标悬停在任务卡片上 | 阴影不重，轻微抬起感 |
| S4 | **最大化按钮** | 看右上角 | 最大化方框线宽正常 |

### 3. macOS 验证（需云 Mac 或实体机）

| 序号 | 测试项 | 操作步骤 | 预期结果 |
|------|--------|----------|----------|
| mac1 | **App 打开** | 从 CI artifact 下载 `.dmg` → 右键 → 打开 | 正常启动，红绿灯可见，无 Windows 自定义控件 |
| mac2 | **macOS CLI** | `OCRFlow.app/Contents/MacOS/OCRFlow --headless parse "/path/to/test.pdf" --json` | `ok: true` |
| mac3 | **macOS MCP** | 点"复制 MCP 配置" → 在 Mac 上粘贴到 `.mcp.json` → Agent 调用 | 工具可发现，调用成功 |
| mac4 | **Python 本地 OCR** | 启用本地 OCR → 拖入 PDF | Python 子进程正常启动 |

---

## 六、已知限制

| 限制 | 说明 | 计划 |
|------|------|------|
| DOCX 公式 | 仅去除 `$` 包裹，未转 Word OMML 公式对象 | 待评估 |
| HTML MathJax 需联网 | 离线环墧公式保持原样 `$...$` | 可本地打包 MathJax |
| macOS 未签名 | CI 构建 DMG 需右键打开 | 正式分发前需 Apple Developer ID |
| Windows CLI 打包后路径 | portable exe 的 MCP 配置依赖绝对路径，移动位置失效 | 已在 UI 中提示 |
| MCP 并发 | 同一时刻仅一个解析任务 | 设计如此 |

---

## 七、结论

- **自动回归**：25 项全部通过
- **历史 Bug 修复**：15 项
- **新发现 Bug**：0 项
- **需手动测试**：9 项（含 macOS 4 项）

当前版本通过了所有自动化回归测试。请按"五、手动测试清单"逐项验证。
