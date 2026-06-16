import { spawn } from 'child_process';
import { existsSync, mkdirSync, realpathSync, readFileSync, statSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const MAX_CAPTURE_BYTES = 64 * 1024;

const inputSchema = {
  paths: z.array(z.string().min(1)).min(1).describe('Absolute local file or folder paths to parse. Use forward slashes or escaped backslashes on Windows.'),
  outputDir: z.string().min(1).optional().describe('Optional output directory for this run'),
  provider: z.enum(['auto', 'mineru-cloud', 'paddleocr-cloud', 'paddleocr-local']).optional().describe('Optional single provider override'),
  providers: z.array(z.enum(['mineru-cloud', 'paddleocr-cloud', 'paddleocr-local'])).optional().describe('Optional provider fallback order. Do not pass provider and providers together.'),
  concurrency: z.number().int().min(1).max(8).optional().describe('Optional concurrency override'),
  chunkSize: z.number().int().min(1).optional().describe('Optional pages-per-chunk override'),
} as any;

interface ParseInput {
  paths: string[];
  outputDir?: string;
  provider?: 'auto' | 'mineru-cloud' | 'paddleocr-cloud' | 'paddleocr-local';
  providers?: Array<'mineru-cloud' | 'paddleocr-cloud' | 'paddleocr-local'>;
  concurrency?: number;
  chunkSize?: number;
}

const APP_VERSION: string = (() => {
  try { return require('../package.json').version; } catch {}
  try { return JSON.parse(readFileSync(join(resolve(__dirname, '..'), 'package.json'), 'utf-8')).version; } catch {}
  return '0.0.0';
})();

let chain = Promise.resolve();

let srv: McpServer | null = null;

async function main(): Promise<void> {
  srv = new McpServer(
    { name: 'ocrflow', version: APP_VERSION },
    { capabilities: { logging: {} } },
  );

  srv.registerTool(
    'parse_documents',
    {
      title: 'Parse documents with OCRFlow',
      description: 'Batch parse local PDF/Office/image files or folders using OCRFlow GUI settings. Writes Markdown outputs to disk and returns a JSON summary.',
      inputSchema,
    },
    async (input: any) => {
      const normalized = normalizeInput(input as ParseInput);
      if ('error' in normalized) return toolError(normalized.error, { ok: false, error: normalized.error });

      // Chain sequential calls without rejecting. Each call waits for the
      // previous one to finish, so multiple parse_documents invocations are
      // processed in order rather than returning a busy error.
      let release: () => void;
      const previous = chain;
      chain = new Promise<void>(r => { release = r; });
      await previous;

      const log = (msg: string, level: 'notice' | 'warning' | 'error' = 'notice') => {
        srv?.server.sendLoggingMessage({ level, data: msg }).catch(() => {});
      };
      log('开始处理 ' + normalized.value.paths.length + ' 个路径');

      try {
        const result = await runOcrflowCli(normalized.value, log);
        const structured = safeSummary(result.summaryText) || { ok: result.exitCode === 0, raw: result.summaryText };
        const isError = result.exitCode !== 0 || (typeof structured === 'object' && structured !== null && (structured as any).ok === false);
        return {
          isError,
          structuredContent: structured as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }],
        };
      } catch (err: any) {
        const msg = err?.message || String(err);
        return toolError(msg, { ok: false, error: msg });
      } finally {
        release!();
      }
    },
  );

  await srv.connect(new StdioServerTransport());
}

function normalizeInput(input: ParseInput): { value: ParseInput } | { error: string } {
  if (input.provider && input.providers && input.providers.length > 0) {
    return { error: 'Pass either provider or providers, not both.' };
  }
  const paths = (input.paths || []).map(cleanPath).filter(Boolean);
  if (paths.length === 0) return { error: 'At least one input path is required.' };
  return {
    value: {
      ...input,
      paths,
      outputDir: input.outputDir ? resolveOutputDir(input.outputDir) : undefined,
    },
  };
}

type LogFn = (message: string, level?: 'notice' | 'warning' | 'error') => void;

function runOcrflowCli(input: ParseInput, log?: LogFn): Promise<{ exitCode: number; summaryText: string }> {
  const { command, baseArgs, cwd } = resolveOcrflowCommand();
  const args = [...baseArgs, ...input.paths];

  if (input.outputDir) args.push('--out', input.outputDir);
  if (input.providers && input.providers.length > 0) {
    args.push('--providers', input.providers.join(','));
  } else if (input.provider) {
    args.push('--provider', input.provider);
  }
  if (input.concurrency) args.push('--concurrency', String(input.concurrency));
  if (input.chunkSize) args.push('--chunk-size', String(input.chunkSize));
  args.push('--json');

  return new Promise(resolveResult => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        windowsHide: true,
        env: (() => {
          const safe = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'USER', 'LANG', 'LC_ALL', 'SHELL',
            'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
            'OCRFLOW_COMMAND'];
          const env: Record<string, string> = {};
          for (const key of safe) {
            const val = process.env[key];
            if (val) env[key] = val;
          }
          return env;
        })(),
      });
    } catch (err: any) {
      resolveResult({
        exitCode: 1,
        summaryText: JSON.stringify({ ok: false, error: err.message || String(err), command, args, cwd }, null, 2),
      });
      return;
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => { stdout = appendCapped(stdout, data.toString()); });
    child.stderr.on('data', data => { stderr = appendCapped(stderr, data.toString()); });
    if (log) {
      let stderrLineBuf = '';
      child.stderr.on('data', (data: Buffer) => {
        stderrLineBuf += data.toString();
        const lines = stderrLineBuf.split('\n');
        stderrLineBuf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          if (/ERRO|ERROR|失败|错误/.test(t)) log(t, 'error');
          else if (/WARN|警告/.test(t)) log(t, 'warning');
          else log(t, 'notice');
        }
      });
    }

    const OCRFLOW_TIMEOUT_MS = 3_600_000; // 1 hour max for large documents
    let timedOut = false;
    let processExited = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (!processExited) { try { child.kill('SIGKILL'); } catch {} }
      }, 5000);
      resolveResult({
        exitCode: 1,
        summaryText: JSON.stringify({
          ok: false,
          error: 'OCRFlow timed out after ' + Math.round(OCRFLOW_TIMEOUT_MS / 1000) + 's',
          command,
          args,
          cwd,
        }, null, 2),
      });
    }, OCRFLOW_TIMEOUT_MS);

    child.on('error', err => {
      clearTimeout(timer);
      resolveResult({
        exitCode: 1,
        summaryText: JSON.stringify({ ok: false, error: err.message, command, args, cwd }, null, 2),
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      processExited = true;
      if (timedOut) return;
      const parsed = extractJson(stdout);
      if (parsed) {
        const forcedError = typeof parsed === 'object' && parsed !== null && (parsed as any).ok === false;
        resolveResult({ exitCode: forcedError ? 1 : (code ?? 1), summaryText: JSON.stringify(parsed, null, 2) });
        return;
      }
      resolveResult({
        exitCode: 1,
        summaryText: JSON.stringify({
          ok: false,
          error: 'OCRFlow CLI did not return valid JSON',
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        }, null, 2),
      });
    });
  });
}

function resolveOcrflowCommand(): { command: string; baseArgs: string[]; cwd: string } {
  const appRoot = resolve(__dirname, '..');
  const explicit = stripOuterQuotes(process.env.OCRFLOW_COMMAND || '');
  if (explicit) return { command: explicit, baseArgs: ['--headless', 'parse'], cwd: dirname(explicit) };

  const electronPackage = join(appRoot, 'node_modules', 'electron');
  if (existsSync(electronPackage)) {
    const electronBinary = require('electron') as string;
    return { command: electronBinary, baseArgs: [appRoot, '--headless', 'parse'], cwd: appRoot };
  }

  const packaged = resolvePackagedExecutable(appRoot);
  if (packaged) return { command: packaged, baseArgs: ['--headless', 'parse'], cwd: dirname(packaged) };

  const localExe = resolve(appRoot, process.platform === 'win32' ? 'OCRFlow.exe' : 'OCRFlow');
  if (existsSync(localExe)) return { command: localExe, baseArgs: ['--headless', 'parse'], cwd: appRoot };

  const cmd = process.platform === 'win32' ? 'OCRFlow.exe' : 'OCRFlow';
  process.stderr.write('[ocrflow-mcp] Cannot find OCRFlow executable. Set OCRFLOW_COMMAND env or ensure ' + cmd + ' is on PATH.\n');
  return { command: cmd, baseArgs: ['--headless', 'parse'], cwd: appRoot };
}

function resolvePackagedExecutable(appRoot: string): string | null {
  const winExe = resolve(appRoot, '..', '..', 'OCRFlow.exe');
  if (process.platform === 'win32' && existsSync(winExe)) return winExe;

  // macOS .app bundle: app.asar.unpacked is at Contents/Resources/app.asar.unpacked/
  // OCRFlow binary is at Contents/MacOS/OCRFlow → 3 levels up from asar root
  const macExe = resolve(appRoot, '..', '..', '..', 'MacOS', 'OCRFlow');
  if (process.platform === 'darwin' && existsSync(macExe)) return macExe;

  return null;
}

function cleanPath(value: string): string {
  const cleaned = stripOuterQuotes(String(value).trim());
  if (!cleaned) return '';
  try {
    const resolved = realpathSync(cleaned);
    const stat = statSync(resolved);
    if (stat.isDirectory()) return resolved;
    const ext = extname(resolved).toLowerCase();
    const SUPPORTED_EXTENSIONS = new Set(['.pdf','.png','.jpg','.jpeg','.jp2','.webp','.gif','.bmp','.tif','.tiff','.pptx','.ppt','.docx','.doc','.xlsx','.txt','.wps','.ofd']);
    if (!SUPPORTED_EXTENSIONS.has(ext)) return '';
    return resolved;
  } catch {
    return '';
  }
}

function resolveOutputDir(value: string): string {
  const cleaned = stripOuterQuotes(String(value).trim());
  if (!cleaned) return '';
  const resolved = resolve(cleaned);
  try { if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true }); } catch {}
  return resolved;
}

function stripOuterQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function appendCapped(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= MAX_CAPTURE_BYTES) return combined;
  return '[truncated]\n' + combined.slice(combined.length - MAX_CAPTURE_BYTES);
}

function safeSummary(text: string): unknown | null {
  try { return JSON.parse(text); } catch { return null; }
}

function extractJson(output: string): unknown | null {
  const text = output.replace(/^\[truncated\]\n?/, '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

function toolError(message: string, structured: Record<string, unknown>) {
  return {
    isError: true,
    structuredContent: structured,
    content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) || message }],
  };
}

main().catch(err => {
  process.stderr.write('[ocrflow-mcp] ' + (err.message || String(err)) + '\n');
  process.exit(1);
});
