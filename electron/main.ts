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
    await stopHeadlessServices().catch(() => {});
    if (headless.options.json) console.log(JSON.stringify(summary, null, 2));
    app.exit(code);
    return;
  }

  // Clean up stale _ocrflow_tmp dirs left over from previous sessions
  try {
    const { readdirSync, rmSync, existsSync } = require('fs');
    const { join } = require('path');
    const { loadSettings } = require('./state-manager');
    const outputDir = loadSettings().outputDir;
    const tmpParent = join(outputDir, '_ocrflow_tmp');
    if (existsSync(tmpParent)) {
      for (const entry of readdirSync(tmpParent)) {
        try { rmSync(join(tmpParent, entry), { recursive: true, force: true }); } catch {}
      }
      try { rmSync(tmpParent, { force: true }); } catch {}
    }
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

