import { app, ipcMain, dialog, BrowserWindow, shell } from 'electron';
import axios from 'axios';
import { scanFiles } from './pipeline/scanner';
import { analyzeFiles } from './pipeline/preprocessor';
import { splitFileByProvider } from './pipeline/splitter';
import { routeTask, buildTaskFromFile } from './providers/provider-router';
import { registerProvider } from './providers/provider-registry';
import { MinerUCloudProvider } from './providers/mineru-cloud';
import { PaddleOCRCloudProvider } from './providers/paddleocr-cloud';
import { PaddleOCRLocalProvider } from './providers/paddleocr-local';
import { taskWorker } from './task-worker';
import { getProviderQuotas } from './page-counter';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadTasks, generateJobId } from './state-manager';
import { AppSettings, ProviderStatus, Task, ProviderType } from './types';
import { join } from 'path';
import { ProviderHealth } from './providers/i-provider';
import { pythonBridge } from './python-bridge';

let mineruCloud: MinerUCloudProvider;
let paddleocrCloud: PaddleOCRCloudProvider;
let paddleocrLocal: PaddleOCRLocalProvider;

export function registerIpcHandlers(): void {
  const settings = loadSettings();

  // Init providers
  mineruCloud = new MinerUCloudProvider(settings.providers.mineruCloud.token);
  mineruCloud.setModeLogCallback((msg, level) => taskWorker.log('[MinerU] ' + msg, level));
  paddleocrCloud = new PaddleOCRCloudProvider(settings.providers.paddleocrCloud.token);
  paddleocrLocal = new PaddleOCRLocalProvider();
  paddleocrLocal.configure(
    settings.providers.paddleocrLocal.enabled,
    settings.providers.paddleocrLocal.port,
    settings.providers.paddleocrLocal.pythonPath
  );

  registerProvider(mineruCloud);
  registerProvider(paddleocrCloud);
  registerProvider(paddleocrLocal);

  // Wire pythonBridge stderr to taskWorker log so Python errors reach frontend
  pythonBridge.setLogCallback((entry) => {
    taskWorker.log(entry.message, entry.level);
  });

  // Init task worker
  taskWorker.configure({
    onUpdate: (tasks) => BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tasks-update', tasks)),
    onLog: (entry) => BrowserWindow.getAllWindows().forEach(w => w.webContents.send('log-entry', entry)),
    onProgress: (progress) => BrowserWindow.getAllWindows().forEach(w => w.webContents.send('progress-update', progress))
  });
  taskWorker.setConcurrency(settings.concurrency);
  taskWorker.setProviderPriority(settings.providerPriority);
  taskWorker.restoreTasks(loadTasks());
  if (settings.autoStart) {
    taskWorker.resume();
  }

  // ========== File handling ==========
  ipcMain.handle('select-files', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      title: '选择要处理的文件',
      filters: [
        { name: '支持的文档和图片', extensions: ['pdf', 'pptx', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'jp2', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'txt', 'wps', 'ofd'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('select-folder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择要处理的文件夹' });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('add-files', async (_event, rawPaths: unknown) => {
    // ---- Parameter validation ----
    if (!Array.isArray(rawPaths)) {
      taskWorker.log('add-files 收到无效参数类型: ' + typeof rawPaths, 'error');
      return;
    }
    const paths: string[] = rawPaths.filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length === 0) {
      taskWorker.log('add-files 收到空路径列表', 'warn');
      return;
    }

    taskWorker.log('收到 ' + paths.length + ' 个路径', 'info');
    try {
      const files = scanFiles(paths);
      taskWorker.log('扫描完成: ' + files.length + ' 个文件', 'info');
      if (files.length === 0) {
        taskWorker.log('未找到支持的文件格式。支持: PDF, PPTX, DOCX, XLSX, 图片', 'warn');
        return;
      }

      const analyzed = await analyzeFiles(files);
      const valid = analyzed.filter(f => f.pageCount > 0);
      taskWorker.log('分析完成: ' + valid.length + ' 个有效文件', 'info');

      const currentSettings = loadSettings();
      const providerPriority = taskWorker.getProviderPriority();

      // Build fresh provider status (call health checks for critical providers).
      // Always call healthCheck() — MinerU works in Agent mode without a token,
      // and healthCheck() already handles this correctly.
      const localHealth = await paddleocrLocal.healthCheck();
      const mineruHealth = await mineruCloud.healthCheck();
      const paddleocrCloudHealth = await paddleocrCloud.healthCheck();

      const providerStatus: ProviderStatus[] = [
        { type: 'mineru-cloud', available: mineruHealth.available, quotaExhausted: false, lastChecked: new Date().toISOString(), lastError: mineruHealth.message },
        { type: 'paddleocr-cloud', available: paddleocrCloudHealth.available, quotaExhausted: false, lastChecked: new Date().toISOString(), lastError: paddleocrCloudHealth.message },
        { type: 'paddleocr-local', available: localHealth.available, quotaExhausted: false, lastChecked: new Date().toISOString(), lastError: localHealth.message }
      ];

      const tasks: Task[] = [];
      for (const file of analyzed) {
        if (file.pageCount === 0) {
          taskWorker.log('跳过 ' + file.name + ': 无法读取页数', 'warn');
          continue;
        }

        const route = await routeTask(file, providerPriority, providerStatus);
        if (!route.provider) {
          taskWorker.log('跳过 ' + file.name + ': 无可用 Provider (' + (route.reason || '未知原因') + ')', 'warn');
          continue;
        }

        taskWorker.log('路由: ' + file.name + ' → ' + route.provider.type + ' (' + file.pageCount + '页 ' + (file.sizeBytes / 1024 / 1024).toFixed(1) + 'MB)', 'info');

        // Use user-configured chunk size if smaller than provider default
        const userChunkSize = currentSettings.chunkSize || 10;
        const providerChunkSize = route.provider.getChunkSize();
        const effectiveChunkSize = Math.min(userChunkSize, providerChunkSize);
        const jid = generateJobId();
        const split = await splitFileByProvider(file, route.provider.type, effectiveChunkSize, jid, currentSettings.outputDir);
        taskWorker.log('拆分: ' + file.name + ' → ' + split.totalChunks + ' chunk(s) (' + effectiveChunkSize + '页/块)', 'info');

        const task = buildTaskFromFile(file, split.chunks, route.provider, currentSettings.outputDir, currentSettings.outputFormats, jid);
        tasks.push(task);
      }

      if (tasks.length > 0) {
        taskWorker.addTasks(tasks);
      } else {
        taskWorker.log('没有可处理的任务。', 'warn');
      }
    } catch (err: any) {
      taskWorker.log('添加文件失败: ' + err.message, 'error');
      console.error('[add-files error]', err);
    }
  });

  ipcMain.handle('get-tasks', () => taskWorker.getAllTasks());
  ipcMain.on('pause-queue', () => taskWorker.pause());
  ipcMain.on('resume-queue', () => taskWorker.resume());

  ipcMain.on('cancel-task', (_e, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) {
      taskWorker.log('cancel-task 收到无效 jobId: ' + typeof jobId, 'warn');
      return;
    }
    taskWorker.cancelTask(jobId);
  });

  ipcMain.on('retry-task', (_e, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) {
      taskWorker.log('retry-task 收到无效 jobId: ' + typeof jobId, 'warn');
      return;
    }
    taskWorker.retryTask(jobId);
  });

  // Remove task from backend queue AND persistent JSON
  ipcMain.on('remove-task', (_e, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) return;
    taskWorker.removeTask(jobId);
  });

  // ========== Window controls (frameless) ==========
  ipcMain.on('win-minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.on('win-maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
  });
  ipcMain.on('win-close', () => BrowserWindow.getFocusedWindow()?.close());

  // ========== Settings ==========
  ipcMain.handle('select-output-dir', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return '';
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择输出目录' });
    return result.canceled ? '' : result.filePaths[0] || '';
  });

  ipcMain.handle('open-output-dir', (_event, dirPath?: unknown) => {
    const target = typeof dirPath === 'string' && dirPath ? dirPath : loadSettings().outputDir;
    shell.openPath(target);
  });

  ipcMain.handle('save-settings', (_e, rawSettings: unknown) => {
    // Basic schema guard: ensure it's an object
    if (!rawSettings || typeof rawSettings !== 'object') {
      taskWorker.log('save-settings 收到无效参数', 'error');
      return;
    }
    const s = rawSettings as AppSettings;

    // Validate concurrency range
    if (typeof s.concurrency === 'number') {
      s.concurrency = Math.max(1, Math.min(8, Math.round(s.concurrency)));
    }

    // Filter providerPriority to only valid doc-provider types —
    // prevents non-doc IDs (ollama, openai-compat, etc.) from leaking in
    const VALID_DOC_PROVIDERS: ProviderType[] = ['mineru-cloud', 'paddleocr-cloud', 'paddleocr-local'];
    if (Array.isArray(s.providerPriority)) {
      const seen = new Set<string>();
      s.providerPriority = s.providerPriority.filter(p => {
        if (!VALID_DOC_PROVIDERS.includes(p as ProviderType)) return false;
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
      });
    }
    // Ensure at least one provider is present
    if (!s.providerPriority || s.providerPriority.length === 0) {
      s.providerPriority = ['mineru-cloud', 'paddleocr-cloud'];
    }

    // Validate outputFormats
    const VALID_FORMATS = new Set(['md', 'json', 'html', 'docx']);
    if (Array.isArray(s.outputFormats)) {
      s.outputFormats = s.outputFormats.filter(f => VALID_FORMATS.has(f));
    }
    if (!s.outputFormats || s.outputFormats.length === 0) {
      s.outputFormats = ['md'];
    }

    const ok = saveSettings(s);
    if (!ok) {
      taskWorker.log('设置保存失败（磁盘可能已满）', 'error');
      return;
    }
    // Guard: providers may be missing from malformed settings objects
    if (s.providers?.mineruCloud) {
      mineruCloud.updateToken(s.providers.mineruCloud.token);
    }
    if (s.providers?.paddleocrCloud) {
      paddleocrCloud.updateToken(s.providers.paddleocrCloud.token);
    }
    if (s.providers?.paddleocrLocal) {
      paddleocrLocal.configure(
        s.providers.paddleocrLocal.enabled,
        s.providers.paddleocrLocal.port,
        s.providers.paddleocrLocal.pythonPath,
      );
    }
    taskWorker.setConcurrency(s.concurrency);
    taskWorker.setProviderPriority(s.providerPriority);
    taskWorker.log('设置已保存', 'success');
  });

  ipcMain.handle('load-settings', () => loadSettings());

  // Return only the default settings (frontend uses this so defaults stay in sync)
  ipcMain.handle('get-default-settings', () => DEFAULT_SETTINGS);

  // ========== Provider management ==========
  ipcMain.handle('get-provider-status', async () => {
    let mineruHealth: ProviderHealth = { available: false, message: '检测失败' };
    let baiduHealth: ProviderHealth = { available: false, message: '检测失败' };
    let localHealth: ProviderHealth = { available: false, message: '检测失败' };
    try { mineruHealth = await mineruCloud.healthCheck(); } catch (e: any) { mineruHealth = { available: false, message: '异常: ' + (e.message || '') }; }
    try { baiduHealth = await paddleocrCloud.healthCheck(); } catch (e: any) { baiduHealth = { available: false, message: '异常: ' + (e.message || '') }; }
    try { localHealth = await paddleocrLocal.healthCheck(); } catch (e: any) { localHealth = { available: false, message: '异常: ' + (e.message || '') }; }
    return [
      { type: 'mineru-cloud', available: mineruHealth.available, quotaExhausted: false, lastChecked: new Date().toISOString(), lastError: mineruHealth.message },
      { type: 'paddleocr-cloud', available: baiduHealth.available, quotaExhausted: false, lastChecked: new Date().toISOString(), lastError: baiduHealth.message },
      { type: 'paddleocr-local', available: localHealth.available, quotaExhausted: false, lastChecked: new Date().toISOString(), lastError: localHealth.message }
    ];
  });

  ipcMain.handle('test-provider', async (_e, type: unknown, creds?: unknown) => {
    if (typeof type !== 'string') return { ok: false, message: '无效的 Provider 类型' };
    const s = loadSettings();
    const c = (creds || {}) as Record<string, unknown>;

    // Priority: creds from UI (unsaved) > stored settings (saved)
    // This allows users to test before clicking "保存设置".
    if (type === 'mineru-cloud') {
      const token = typeof c.token === 'string' ? c.token : s.providers.mineruCloud.token;
      mineruCloud.updateToken(token);
      const h = await mineruCloud.healthCheck();
      return { ok: h.available, message: h.message };
    }
    if (type === 'paddleocr-cloud') {
      const token = typeof c.token === 'string' ? c.token : s.providers.paddleocrCloud.token;
      paddleocrCloud.updateToken(token);
      const h = await paddleocrCloud.healthCheck();
      return { ok: h.available, message: h.message };
    }
    if (type === 'paddleocr-local') {
      const port = typeof c.port === 'number' ? c.port : s.providers.paddleocrLocal.port;
      const pyPath = typeof c.pythonPath === 'string' ? c.pythonPath : s.providers.paddleocrLocal.pythonPath;
      paddleocrLocal.configure(s.providers.paddleocrLocal.enabled, port, pyPath || 'python');
      const h = await paddleocrLocal.healthCheck();
      return { ok: h.available, message: h.message };
    }
    if (type === 'ollama') {
      // Prefer UI live value over stored settings
      const url = (typeof c.url === 'string' ? c.url : s.ollamaUrl) || 'http://localhost:11434';
      return testHttpEndpoint(url, 'Ollama', '/api/tags');
    }
    if (type === 'openai-compat') {
      const url = (typeof c.url === 'string' ? c.url : s.openaiCompatUrl) || 'http://localhost:11434';
      return testHttpEndpoint(url, 'OpenAI 兼容服务', '/v1/models');
    }
    if (type === 'local-service') {
      const url = (typeof c.url === 'string' ? c.url : s.localServiceUrl) || 'http://localhost:8000';
      return testHttpEndpoint(url, '本地专业服务', '/health');
    }
    return { ok: false, message: '未知 Provider' };
  });

  ipcMain.on('set-provider-priority', (_e, providers: unknown) => {
    if (!Array.isArray(providers) || !providers.every(p => typeof p === 'string')) {
      taskWorker.log('set-provider-priority 收到无效参数', 'warn');
      return;
    }
    // Filter to valid doc providers only
    const VALID_DOC_PROVIDERS: ProviderType[] = ['mineru-cloud', 'paddleocr-cloud', 'paddleocr-local'];
    const filtered = providers.filter(p => VALID_DOC_PROVIDERS.includes(p as ProviderType));
    if (filtered.length === 0) return;

    const s = loadSettings();
    s.providerPriority = filtered as ProviderType[];
    saveSettings(s);
    taskWorker.setProviderPriority(filtered as string[]);
  });

  ipcMain.handle('get-quotas', () => getProviderQuotas());

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('get-mcp-config', () => {
    const appPath = app.getAppPath();
    const mcpServerJs = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'mcp-server.js')
      : join(appPath, 'dist-electron', 'mcp-server.js');
    const exePath = app.isPackaged
      ? app.getPath('exe')
      : join(appPath, '..', '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
    return JSON.stringify({
      mcpServers: {
        ocrflow: {
          command: app.isPackaged ? exePath : 'node',
          args: [mcpServerJs],
          env: app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : undefined,
        },
      },
    }, null, 2);
  });
}

async function testHttpEndpoint(baseUrl: string, label: string, path: string): Promise<{ ok: boolean; message: string }> {
  // Build full URL intelligently — prevent double-pathing when base already
  // includes part of the test path. e.g. "http://host:8080/v1" + "/v1/models" → "http://host:8080/v1/models"
  let url: string;
  // Strip trailing /v{num} so it doesn't conflict with the test path prefix
  const cleanBase = baseUrl.replace(/\/+v\d+\/*$/, '').replace(/\/+$/, '');
  if (cleanBase.endsWith(path)) {
    url = cleanBase;
  } else {
    url = cleanBase + path;
  }
  try {
    const resp = await axios.get(url, { timeout: 5000, validateStatus: s => s < 500 });
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, message: label + ' 需要认证或 Token 无效' };
    }
    return { ok: true, message: label + ' 可访问 (HTTP ' + resp.status + ')' };
  } catch (err: any) {
    return { ok: false, message: label + ' 不可访问: ' + err.message };
  }
}
