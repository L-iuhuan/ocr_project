import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { parseHeadlessArgs } from './headless-args';
import { runHeadlessParse, stopHeadlessServices } from './headless-runner';
import { pythonBridge } from './python-bridge';

let mainWindow: BrowserWindow | null = null;
let isHeadlessRun = false;

function createWindow() {
  // Remove default File/Edit menu - useless for our productivity tool
  Menu.setApplicationMenu(null);

  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: isMac,           // Windows: frameless for custom title bar; macOS: native frame needed for traffic lights
    titleBarStyle: isMac ? 'hidden' : 'default',
    title: 'OCRFlow',
    backgroundColor: '#0F172A',
    show: false,
    icon: join(__dirname, isMac ? '../ocr.png' : '../ocr.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const headless = parseHeadlessArgs(process.argv);
  if (headless.mode === 'help') {
    console.log(headless.text);
    app.exit(0);
    return;
  }
  if (headless.mode === 'error') {
    console.error(headless.message + '\n\n' + headless.text);
    app.exit(2);
    return;
  }
  if (headless.mode === 'parse') {
    isHeadlessRun = true;
    const { code, summary } = await runHeadlessParse(headless.options).catch(err => ({
      code: 1,
      summary: {
        ok: false,
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        skipped: [err.message || String(err)],
        tasks: [],
      },
    }));
    if (headless.options.json) {
      const originalConsoleLog = console.log;
      console.log = () => {};
      await stopHeadlessServices().catch(() => {});
      console.log = originalConsoleLog;
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } else {
      await stopHeadlessServices().catch(() => {});
    }
    app.exit(code);
    return;
  }

  // Clean up stale _ocrflow_tmp dirs — only workspaces for tasks that are
  // gone (done, cancelled, removed) are deleted. Active/partial tasks keep
  // their workspace so that retry can reuse finished chunks.
  try {
    const { loadSettings, loadTasks } = require('./state-manager');
    const outputDir = loadSettings().outputDir;
    const tasks = loadTasks();
    const activeJobIds = new Set(tasks.map((t: any) => t.jobId).filter(Boolean));
    require('./pipeline/task-workspace').cleanupStaleWorkspaces(outputDir, activeJobIds);
  } catch {}

  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  pythonBridge.stop().catch(e => console.error('[Main] pythonBridge.stop failed:', e.message || e));
});

app.on('activate', () => {
  if (!isHeadlessRun && BrowserWindow.getAllWindows().length === 0) createWindow();
});

