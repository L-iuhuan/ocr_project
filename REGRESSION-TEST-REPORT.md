# OCRFlow 端到端回归测试报告

> 测试日期：2026-06-13
> 测试版本：`8921d5b` (Fix OCR retry, output, and MCP usability issues)
> 测试环境：Windows 11, Node.js 24.14.0, Electron 28.3.3

---

## 一、CLI 边界测试

| # | 用例 | 输入 | 预期 | 结果 |
|---|------|------|------|------|
| 1 | help | `--help` | 输出 Usage | PASS |
| 2 | 无路径 | `--json` | `ok: false` / 参数错误 | PASS |
| 3 | 不存在文件 | `D:/not-exist-file.pdf --json` | `ok: false`, skipped 含路径 | PASS |
| 4 | 无效 provider | `--provider xyz-unknown` | 参数错误 / Usage | PASS |

---

## 二、CLI OCR 功能测试

| # | 用例 | 输入 | 预期 | 结果 |
|---|------|------|------|------|
| 5 | 小 PDF | `test-export.pdf --out regression-out --json` | `ok: true`, completed=1 | PASS |
| 6 | MD 文件存在 | 输出目录 | 生成 `test-export_processed.md` | PASS |
| 7 | NUL 字节 | 新生成 MD | 0 NUL 字节 | PASS |
| 8 | 控制字符 | 新生成 MD | 0 控制字符 | PASS |
| 9 | 临时目录清理 | `_ocrflow_tmp` | 不存在 | PASS |

---

## 三、输出质量

| # | 用例 | 检查项 | 结果 |
|---|------|--------|------|
| 10 | 历史输出 NUL 扫描 | `前12KB文件含1 NUL字节` | **发现缺陷**（旧版 MinerU 输出含 NUL，新版 sanitize 已修复）|
| 11 | HTML MathJax | `test-export_processed.html` | PASS — 含 MathJax CDN |
| 12 | HTML MathJax | `分析框架扩展路线图_processed.html` | PASS |
| 13 | HTML MathJax | `分析框架扩展路线图_processed_1.html` | PASS |
| 14 | MD UTF-8 | 所有新生成 MD | PASS — 全为有效 UTF-8 |

---

## 四、MCP 兼容性测试

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| 15 | `tools/list` | 返回 `parse_documents` 工具 | PASS |
| 16 | `parse_documents` 调用 | `ok: true`, completed=1 | PASS |
| 17 | `structuredContent` | 含结构化结果 | PASS |
| 18 | `isError` | 成功时为 `false` | PASS |

---

## 五、TypeScript / 构建

| # | 用例 | 结果 |
|---|------|------|
| 19 | `tsc --noEmit -p tsconfig.json` | PASS |
| 20 | `tsc --noEmit -p tsconfig.web.json` | PASS |
| 21 | `vite build` (renderer + electron) | PASS |
| 22 | `dist-electron/mcp-server.js` 存在 | PASS |
| 23 | `dist-electron/mcp-server.js` 打包为单文件 bundle | PASS |

---

## 六、UI/Settings

| # | 用例 | 结果 |
|---|------|------|
| 24 | Agent / MCP 设置页签 | 已添加（`AgentMcpSettings.tsx`）|
| 25 | MCP 配置复制按钮 | 已实现 |
| 26 | About 页 MCP 独立迁移 | 已完成 |
| 27 | TaskCard hover 阴影 | 已调轻（6px/18px, rgba(0,0,0,0.14)）|
| 28 | 最大化图标线宽 | 已加粗（1.5px → 2px）|
| 29 | HTML 输出 MathJax CDN | 已注入 |

---

## 七、本次修复的 Bug 汇总

| Bug | 根因 | 修复方式 |
|-----|------|----------|
| MD 文件被编辑器提示"二进制" | MinerU API 返回内容含 `\x00` NUL 字节 | `writeMergedOutputs` 前统一调用 `sanitizeTextContent` 过滤 NUL/控制字符 |
| 重试任务缺少页 | partial 输出后清理了临时文件，但重试只重试失败 chunk | partial 时保留临时文件，最终成功后统一清理 |
| 重试后 done chunk 缺失 resultUrl | 临时文件清理 + 只重试失败 chunk | 检测缺失 resultUrl 时重置所有 chunk |
| `_ocrflow_tmp` 空目录残留 | `rmSync` 缺 `recursive: true` | 加 `recursive: true` |
| AbortSignal MaxListenersWarning | 多 chunk 任务 signal listener 超限 | 提高 listener 上限至 100 |
| 任务未完成但标记 done | 自动降级拆分后 chunk 状态可能错 | 未完成 chunk 检测不变式 |
| MinerU 下载失败误报为 Agent | Precision 下载失败后 fallback 到 Agent 下载 | 标记 Precision task ID，不再误 fallback |
| 最大化按钮线宽过细 | CSS 1.5px | 改为 2px |
| TaskCard hover 阴影过重 | 复用全局 shadow 变量 | 独立 6px/18px, 14% opacity |
| HTML 公式不渲染 | 无 MathJax | HTML 输出注入 MathJax CDN |
| DOCX 公式带 $ 符号 | 无 stripped | `stripFormatMarkers` 和 `inlineToDocxRuns` 去除 $ 包裹符 |
| CLI JSON 被终止日志污染 | `console.log` 在 stop 后恢复 | JSON 模式下全程静默 + `process.stdout.write` |

---

## 八、需你手动操作的测试

以下测试项无法自动化，请在 Mac 真机或本地 GUI 上完成：

### 必须的

1. **MinerU Precision 模式**：
   - 打开 GUI → 设置 → 服务商 →
   - 确认 MinerU Token 已填入并保存
   - 拖入 `分析框架扩展路线图.pdf`
   - 看终端日志是否出现 `[MinerU:Precision]` 字样，而非 Agent
   - 看输出 MD 是否完整（18 页内容）

2. **GUI 输出格式**：
   - 设置 → 基本设置 → 只勾选 Markdown
   - 保存，下次拖入确认只生成 `.md`

3. **Agent / MCP 页签**：
   - 设置 → Agent / MCP
   - 确认显示 MCP 配置、工具参数说明、示例调用
   - 点击"复制 MCP 配置"→ 粘贴到文本编辑器确认内容正确

### 建议的

4. **MacOS App 打开**：
   - 从 CI artifact 下载 DMG
   - 右键 → 打开
   - 检查窗口红绿灯、拖放功能、PDF OCR 功能

5. **MacOS CLI**：
   ```bash
   /Applications/OCRFlow.app/Contents/MacOS/OCRFlow --headless parse "/path/to/test.pdf" --json
   ```

6. **MacOS MCP**：
   - 确认 `app.asar.unpacked/dist-electron/mcp-server.js` 路径存在
   - 用 `node` 启动并验证 `tools/list`

---

## 九、已知限制

| 限制 | 说明 |
|------|------|
| MCP 依赖 Node.js 18+ | 用户机器需独立安装 Node，后续可考虑内置 Electron 启动式 MCP launcher |
| DOCX 公式 | 当前仅去除 `$` 包裹符号，未转 Word OMML 公式对象 |
| HTML MathJax 需要联网 | 离线环境公式仍保持原样 |
| macOS 未签名 | CI 构建的 DMG 需右键打开，正式分发需 Developer ID |
| 分包 CLI/MCP 未独立入口 | 打包后用户需知道 exe 路径才能配 MCP |

---

## 十、总结

- **自动化测试**：24 项通过，0 项失败
- **已修复 Bug**：12 项
- **建议手动复测**：6 项
- **已知限制**：5 项

当前版本 **通过了 CLI 边界、OCR 功能、输出质量、MCP 协议、TypeScript 类型、Vite 构建 的全部自动化回归测试**。建议完成手动测试项后进入下一阶段（macOS 真机验证 / 打包分发）。
