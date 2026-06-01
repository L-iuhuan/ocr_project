# OCRFlow 代码审查与修复报告

> 审查日期：2026-05-31  
> 审查范围：全项目 E2E 链路  
> 原始项目名：DocFlow → 更名为 OCRFlow  
> 开发者：LIU HUAN

---

## 一、项目概况

OCRFlow 是一个基于 Electron + React + TypeScript 的多引擎 OCR 文档批量处理工具。支持 PDF、图片、Office 文件的智能识别与结构化输出，提供三种处理引擎：

| 引擎 | 类型 | 说明 |
|------|------|------|
| MinerU Cloud | 云端 | Precision（Token）或 Agent（免登录签名上传）模式 |
| PaddleOCR Cloud | 云端 | 百度 PaddleOCR-VL API |
| 本地 OCR 引擎 | 本地 | Python 子进程，可运行 PaddleOCR / MinerU 本地等 |

输出格式：Markdown、JSON、HTML、DOCX

---

## 二、审查发现的问题与修复

### 🔴 严重缺陷（6 项）

#### 1. cancelTask 不终止底层 HTTP 请求 / Python 进程

- **文件**：`electron/task-worker.ts`
- **风险**：僵尸任务、配额浪费、资源泄漏
- **根因**：`cancelTask()` 仅设置 `task.state = 'cancelled'`，`provider.submit()`、`provider.poll()`、`provider.download()` 不受影响
- **修复**：新增 `AbortControllers Map<string, AbortController>`，每个 task 分配一个 controller，cancel 时调用 `controller.abort()`。所有 Provider 的 submit/poll/download 方法增加 `signal?: AbortSignal` 参数透传到底层 HTTP

#### 2. 扫描符号链接目录导致无限递归

- **文件**：`electron/pipeline/scanner.ts`
- **风险**：栈溢出崩溃
- **根因**：`scanDirectory()` 对 `entry.isDirectory()` 无条件递归，Windows 目录 junction 会循环
- **修复**：使用 `realpathSync` 去重 + 最大深度 20 层限制；`sha256First4MB` 改用 `openSync/readSync` 流式读取避免加载完整大文件

#### 3. Windows 保留文件名导致文件创建失败

- **文件**：`electron/pipeline/merger.ts`
- **风险**：Windows 下 CON/PRN/AUX/NUL/COM1-9/LPT1-9 文件名（不论扩展名）无法创建
- **修复**：`sanitizeFileName` 增加保留名检测，命中时前加 `_` 前缀

#### 4. Python 子进程重复启动导致孤儿进程

- **文件**：`electron/python-bridge.ts`
- **风险**：资源泄漏
- **根因**：`start()` 不检查已有进程，直接 spawn 新进程覆盖引用，旧进程成为孤儿
- **修复**：增加守卫——若已有进程且 healthy 直接返回端口，不 healthy 则先 stop 再 start

#### 5. Python stderr 丢失，前端假死无提示

- **文件**：`electron/python-bridge.ts`
- **风险**：Python 崩溃时用户看不到错误，前端一直显示"处理中"
- **根因**：stderr 只输出到 `console.error`，不传递到前端日志系统
- **修复**：`PythonBridge` 新增 `setLogCallback`，stderr 输出通过 taskWorker 发送到前端

#### 6. PaddleOCR Local results Map 永不清理导致内存泄漏

- **文件**：`electron/providers/paddleocr-local.ts`
- **风险**：长时间运行内存持续增长
- **修复**：`download()` 末尾 `this.results.delete(taskId)`

---

### 🟠 中高风险（10 项）

#### 7. MinerU Agent API 格式完全错误

- **文件**：`electron/providers/mineru-cloud.ts`
- **现象**：`{"code":-10002,"msg":"field \"file_name\" is not set"}` — 永远失败
- **根因**：旧版 multipart form-data 直传被新版**签名上传（两步提交）**取代：
  1. `POST /api/v1/agent/parse/file` JSON → 获取 `task_id` + OSS `file_url`
  2. `PUT {file_url}` 二进制文件
  3. `GET /api/v1/agent/parse/{task_id}` 轮询
  4. 下载 `markdown_url` CDN 链接
- **修复**：完整重写 `submitAgent` + `pollAgent` + `downloadAgent`，采用官方文档的两步签名上传模式

#### 8. OSS PUT 返回 403

- **根因**：axios PUT 带了 `Content-Type: application/octet-stream` 自定义头，OSS 签名校验不通过
- **修复**：改用原生 `fetch(url, { method: 'PUT', body: fileData })` — 不添加任何自定义头

#### 9. Provider 故障转移不重新拆分 Chunk

- **文件**：`electron/task-worker.ts`
- **现象**：MinerU（200页/chunk）切换到 PaddleOCR（100页/chunk）后，旧的大 chunk 全部失败
- **修复**：新增 `resplitRemainingChunks()` 方法，切换 Provider 时检测新 chunk 大小，超出限制则重新拆分

#### 10. JSON 持久化非原子写入

- **文件**：`electron/state-manager.ts`
- **风险**：进程崩溃/磁盘满时 JSON 文件损坏，所有任务+设置丢失
- **修复**：`safeWrite` 改为 write-to-temp + rename 原子模式；写入失败返回 boolean，调用方记录日志

#### 11. Token 为空时直接判死 MinerU

- **文件**：`electron/ipc-handlers.ts`
- **现象**：无 Token → `available: false` → "无可用 Provider" — 但 Agent 模式不需要 Token
- **修复**：始终调用 `healthCheck()`，其内部已正确区分 Token/Agent 模式

#### 12. MinerU healthCheck 虚构端点

- **文件**：`electron/providers/mineru-cloud.ts`
- **根因**：`/extract/task/test-check` 端点不存在，抛异常后返回模糊错误
- **修复**：改用实际存在的端点 + 完善 401/404/网络错误的分类，全中文化提示

#### 13. 测试连接不传递 UI 未保存的 token/URL

- **文件**：`electron/ipc-handlers.ts` 多处
- **现象**：输入 token/URL → 点测试 → 读的是磁盘旧值 → 永远失败
- **修复**：`testConnection` 增加 `creds` 参数，优先用 UI 未保存值。PaddleOCR/MinerU 通过 `creds.token` 传递，Ollama/OpenAI 通过 `creds.url` 传递

#### 14. 测试连接 URL 路径重复拼接

- **文件**：`electron/ipc-handlers.ts testHttpEndpoint`
- **现象**：URL `http://host:8080/v1` + 测试路径 `/v1/models` → `http://host:8080/v1/v1/models`
- **修复**：拼接前清理 URL 尾部的 `/v{数字}` 段

#### 15. Toggle 开关不写入 settings 对象

- **文件**：`src/components/SettingsView.tsx`
- **现象**：所有 toggle 开关（autoExtractZip、deleteChunkTemp、keepImages、ollamaEnabled 等）只更新本地 `toggles` state，保存设置时丢失
- **修复**：`toggleSwitch` 增加 `TOGGLE_FIELD_MAP` 映射，同步写入 `settings`

#### 16. 图片路径浏览按钮绑定错误

- **文件**：`src/components/GeneralSettings.tsx`
- **现象**：点击图片保存路径的"浏览" → 调 `chooseOutputDir` → 写入了 `outputDir` 而非 `imageOutputDir`
- **修复**：新增独立 `chooseImageOutputDir` 回调

---

### 🟡 中等风险（8 项）

#### 17. 服务商优先级 UI 乱序 bug

- **文件**：`src/components/ProviderSettings.tsx`
- **根因**：`prevSettingsRef` 在 render 阶段执行，与 `handleDrop` 的 `setItems` + `setSettings` 存在竞态窗口
- **修复**：render 阶段副作用移至 `useEffect`（render 之后执行），`handleDrop` 同步更新 `lastSettingsDocOrderRef`

#### 18. 设置中 providerPriority 脏数据持久化

- **文件**：`electron/ipc-handlers.ts` `save-settings` + `set-provider-priority`
- **修复**：2 处 handler 增加过滤——非 doc provider ID 剔除 + 去重 + 最少保留 1 个

#### 19. 配额计数不推送到前端

- **文件**：`electron/task-worker.ts` + `electron/preload.ts` + `src/App.tsx`
- **现象**：任务完成后 `incrementPageCount` 写入 JSON 但前端不更新
- **修复**：新增 `emitQuotaUpdate()` → `quotas-update` IPC → `onQuotasUpdate` preload → `SET_QUOTAS` dispatch

#### 20. 日志使用 array index 作为 React key

- **文件**：`src/store/AppContext.tsx` + `src/App.tsx`
- **风险**：过滤时 DOM 复用错乱
- **修复**：日志条目增加单调递增 `id` 字段，列表使用 1000 条环形缓冲区

#### 21. 100+ 任务时全量重渲染卡顿

- **文件**：`src/App.tsx` + `src/components/TaskCard.tsx`
- **风险**：`SET_TASKS` 触发整棵树重渲染
- **修复**：`TaskCard` 包裹 `React.memo`；`App.tsx` 派生数据全部 `useMemo` 缓存

#### 22. mergeChunks 单 Chunk 注释剥离脆弱

- **文件**：`electron/pipeline/merger.ts`
- **根因**：`lastIndexOf('-->')` 遇到内容含 `-->` 时误截断
- **修复**：改用精确正则 `/^<!-- .+? -->\n\n/`

#### 23. findImageFiles 无深度限制

- **文件**：`electron/pipeline/merger.ts`
- **修复**：增加 `maxDepth = 10` 参数

#### 24. Chunk 文件名不含页码信息

- **文件**：`electron/pipeline/splitter.ts`
- **修复**：文件名格式 `{name}_p{start}-{end}_{uuid8}.pdf`，JSON 损坏时可从文件名恢复

---

### 🟢 低风险 / 体验优化（6 项）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 25 | `AboutView.tsx` | 开发者 "DocFlow Team" | 改为 "LIU HUAN"，技术栈区块增加 pdf-lib/adm-zip/form-data/axios |
| 26 | `LocalInferenceSettings.tsx` | 全部 input 使用 `defaultValue`（非受控），修改不生效 | 全部改为 `value` + `onChange` → `updateSetting` |
| 27 | `output-normalizer.ts` | `extractMarkdownFromRaw` 静默吞错 | 增加 `console.warn` |
| 28 | `preprocessor.ts` | 500MB PDF 可能 OOM | 改为顺序处理 + 注释说明内存约束 |
| 29 | `image-optimizer.ts` | sharp 崩溃导致整个任务失败 | 全部包裹 try-catch，损坏图片返回原路径 |
| 30 | `scanner.ts` | 去重仅用 SHA256 前 4MB | 增加文件大小作为第二判据 |

---

## 三、新增功能

### IPC 通道

| 通道 | 方向 | 用途 |
|------|------|------|
| `quotas-update` | main → renderer | 任务完成后推送最新配额数据 |
| `onQuotasUpdate` | preload API | 渲染进程监听配额更新 |

### Provider 接口扩展

```typescript
interface IProvider {
  submit(chunkPath, onProgress?, signal?): Promise<string>
  poll(taskId, signal?): Promise<'done'|'failed'|'running'|'pending'>
  download(taskId, destDir, signal?): Promise<ParsedChunkResult>
}
```

新增可选 `signal?: AbortSignal` 参数，支持 HTTP 请求中途取消。

---

## 四、状态栏/统计计数规则

| 数据 | 存储 | 清除任务后 | 重启后 |
|------|------|-----------|--------|
| 任务列表 | `ocrflow_tasks.json` | done/failed 隐藏 | done 自动归档 |
| 状态栏计数 | tasks[] 实时计算 | 归零 | 归零 |
| 累计统计 | `localStorage` | 不变 | 不变 |
| 每日配额 | `ocrflow_counters.json` | 不变 | 不变（按天累计） |

**状态栏的计数规则**：每次打开应用，状态栏计数从零开始。处理中有实时更新。清除任务后对应计数归零。但任务统计弹窗中的累计数字永久保留在 localStorage 中，不受清除影响。

---

## 五、LLM 后处理引擎状态

三个引擎（Ollama、OpenAI 兼容、本地专业服务）的 UI 和连接测试已实现，但**尚未接入文档处理管线**。当前版本已折叠隐藏，待后续版本启用。

| 引擎 | 用途 | 状态 |
|------|------|------|
| Ollama | 本地视觉大模型 | 已折叠 |
| OpenAI 兼容 | LM Studio / vLLM / llama.cpp | 已折叠 |
| 本地专业服务 | MinerU/PaddleOCR 本地部署 | 已折叠 |

---

## 六、已折叠/暂时禁用的功能清单

以下功能代码已保留但 UI 已折叠或隐藏，可在条件成熟时重新启用：

| 功能 | 涉及文件 | 折叠方式 |
|------|---------|----------|
| LLM 后处理引擎全套 UI | `LocalInferenceSettings.tsx` | `opacity: 0.45 + pointerEvents: 'none'` |
| 服务商优先级列表中 Ollama/OpenAI/本地服务条目 | `ProviderSettings.tsx` | 已从 `buildPriorityItems` 移除 |
| 优先级分隔条 | `ProviderSettings.tsx` | 已删除 dead code |

---

## 七、命名变更

| 旧 | 新 | 涉及文件 |
|----|-----|---------|
| DocFlow | OCRFlow | package.json / index.html / main.ts / TopBar / StatusBar / AboutView / AppContext |
| docflow_*.json | ocrflow_*.json | state-manager.ts（数据文件） |
| docflow-palette / docflow-theme | ocrflow-palette / ocrflow-theme | useTheme.ts（localStorage keys） |
| _docflow_tmp | _ocrflow_tmp | task-worker.ts / merger.ts（临时目录） |
| DocFlow Team | LIU HUAN | AboutView.tsx |
| 本地 PaddleOCR | 本地 OCR 引擎 | ProviderSettings.tsx |

---

## 八、图标

使用用户提供的 `ocr.ico`，配置在 `package.json`（electron-builder）和 `electron/main.ts`（dev 模式）。

---

## 九、编译验证

所有修改通过 `npx tsc --noEmit` 零错误验证。

---

**报告人**：Claude Code  
**审查方式**：全量代码阅读 + 逐文件修复 + TypeScript 编译验证  
**改动文件数**：20 个源文件  
**新增文件数**：1（本报告）
