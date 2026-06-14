import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { join } from 'path';
import { app } from 'electron';
import axios from 'axios';
import { existsSync, readFileSync, statSync } from 'fs';

export interface PythonEnv {
  pythonInstalled: boolean;
  pythonVersion: string;
  paddleocrInstalled: boolean;
}

type LogCallback = (entry: { timestamp: string; level: 'info' | 'warn' | 'error' | 'success'; message: string }) => void;

export class PythonBridge {
  private process: ChildProcess | null = null;
  private port: number = 0;
  private healthy: boolean = false;
  private onLog?: LogCallback;

  /** Register a log callback so stderr output reaches the frontend */
  setLogCallback(cb: LogCallback): void {
    this.onLog = cb;
  }

  async checkEnvironment(pythonPath = 'python'): Promise<PythonEnv> {
    const result: PythonEnv = {
      pythonInstalled: false,
      pythonVersion: '',
      paddleocrInstalled: false
    };

    try {
      const version = await this.execCommand(pythonPath, ['--version']);
      result.pythonInstalled = true;
      result.pythonVersion = version.trim();
    } catch {
      return result;
    }

    try {
      await this.execCommand(pythonPath, ['-c', 'import paddleocr; print("OK")']);
      result.paddleocrInstalled = true;
    } catch {
      // paddleocr not installed
    }

    return result;
  }

  async start(pythonPath = 'python', preferredPort?: number): Promise<number> {
    // Guard: if already running and healthy, just return current port
    if (this.process && this.healthy) {
      return this.port;
    }

    // Guard: if a process exists but is unhealthy, kill it first
    if (this.process) {
      await this.stop();
    }

    // If the configured port already has a compatible OCR service, use it.
    // This allows users to run PaddleOCR/MinerU local services externally.
    if (preferredPort && await isServiceHealthy(preferredPort)) {
      this.port = preferredPort;
      this.healthy = true;
      return this.port;
    }

    // Find available port for OCRFlow's bundled fallback server.
    this.port = preferredPort
      ? await findAvailablePort(preferredPort, Math.max(preferredPort, 52987))
      : await findAvailablePort(51987, 52987);

    const serverScript = resolvePythonServerScript();

    this.process = spawn(pythonPath, [
      serverScript,
      '--port', String(this.port),
      '--pipeline', 'layout_parsing'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log('[Python OCR]', msg);
      if (msg.includes('Uvicorn running')) {
        this.healthy = true;
      }
    });

    // Forward stderr to frontend log system via callback
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (!msg) return;
      console.error('[Python OCR Error]', msg);
      // Forward to frontend so users can see Python errors
      if (this.onLog) {
        this.onLog({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: '[Python OCR] ' + msg
        });
      }
    });

    this.process.on('exit', (code) => {
      const codestr = code !== null ? String(code) : 'signal';
      console.log(`[Python OCR] Process exited with code ${codestr}`);
      if (code !== 0 && code !== null && this.onLog) {
        this.onLog({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: `[Python OCR] 进程异常退出 (exit code: ${codestr})`
        });
      }
      this.healthy = false;
      this.process = null;
    });

    // Wait for server to be ready (max 120 seconds)
    await this.waitForReady(120000);

    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    this.process.kill('SIGTERM');

    // Wait 5s for graceful shutdown
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.process?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.process = null;
    this.healthy = false;
  }

  async parse(filePath: string, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    if (!this.healthy) {
      throw new Error('本地 OCR 服务未就绪');
    }

    const stat = statSync(filePath);
    if (stat.size > 500 * 1024 * 1024) {
      throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，本地 OCR 不支持超过 500MB 的文件`);
    }

    const fs = await import('fs');
    const fileData = fs.readFileSync(filePath);
    const base64 = fileData.toString('base64');
    const ext = filePath.split('.').pop()?.toLowerCase();
    const isPdf = ext === 'pdf';

    const resp = await axios.post(`http://127.0.0.1:${this.port}/layout-parsing`, {
      file: base64,
      fileType: isPdf ? 0 : 1,
      file_name: filePath.split(/[/\\]/).pop() || 'document',
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useTextlineOrientation: false,
      useTableRecognition: true,
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 600000,
      ...(signal ? { signal, maxBodyLength: Infinity, maxContentLength: Infinity } : { maxBodyLength: Infinity, maxContentLength: Infinity }),
    });

    return resp.data;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.healthy) return false;
    try {
      const resp = await axios.get(`http://127.0.0.1:${this.port}/health`, { timeout: 2000 });
      return resp.status === 200;
    } catch {
      return false;
    }
  }

  isRunning(): boolean {
    return this.healthy;
  }

  getPort(): number {
    return this.port;
  }

  private async execCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
      proc.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`Command failed with code ${code}: ${output}`));
      });
      proc.on('error', reject);
    });
  }

  private async waitForReady(timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.healthy) return;
      try {
        const resp = await axios.get(`http://127.0.0.1:${this.port}/health`, { timeout: 1000 });
        if (resp.status === 200) { this.healthy = true; return; }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('本地 OCR 服务启动超时');
  }
}

function resolvePythonServerScript(): string {
  const appPath = app.getAppPath();
  const normal = join(appPath, 'python', 'local_ocr_server.py');
  if (existsSync(normal)) return normal;

  // When packaged in app.asar, electron-builder places asarUnpack files next
  // to it under app.asar.unpacked. External Python cannot execute ASAR paths.
  const unpacked = normal.replace('app.asar', 'app.asar.unpacked');
  if (existsSync(unpacked)) return unpacked;

  return normal;
}

async function isServiceHealthy(port: number): Promise<boolean> {
  try {
    const resp = await axios.get(`http://127.0.0.1:${port}/health`, { timeout: 2000 });
    return resp.status === 200;
  } catch {
    return false;
  }
}

function findAvailablePort(start: number, end: number): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number) {
      if (port > end) return reject(new Error('No available port found'));
      const server = createServer();
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port));
      });
      server.on('error', () => tryPort(port + 1));
    }
    tryPort(start);
  });
}

export const pythonBridge = new PythonBridge();
