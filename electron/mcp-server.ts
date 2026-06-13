import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
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

let activeRun = false;

async function main(): Promise<void> {
  const server = new McpServer({ name: 'ocrflow', version: APP_VERSION });

  server.registerTool(
    'parse_documents',
    {
      title: 'Parse documents with OCRFlow',
      description: 'Batch parse local PDF/Office/image files or folders using OCRFlow GUI settings. Writes Markdown outputs to disk and returns a JSON summary.',
      inputSchema,
    },
    async (input: any) => {
      const normalized = normalizeInput(input as ParseInput);
      if ('error' in normalized) return toolError(normalized.error, { ok: false, error: normalized.error });
      if (activeRun) return toolError('OCRFlow is already processing another MCP request. Wait for it to finish and retry.', { ok: false, error: 'busy' });

      activeRun = true;
      try {
        const result = await runOcrflowCli(normalized.value);
        const structured = safeSummary(result.summaryText) || { ok: result.exitCode === 0, raw: result.summaryText };
        const isError = result.exitCode !== 0 || (typeof structured === 'object' && structured !== null && (structured as any).ok === false);
        return {
          isError,
          structuredContent: structured as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }],
        };
      } finally {
        activeRun = false;
      }
    },
  );

  await server.connect(new StdioServerTransport());
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
      outputDir: input.outputDir ? cleanPath(input.outputDir) : undefined,
    },
  };
}

function runOcrflowCli(input: ParseInput): Promise<{ exitCode: number; summaryText: string }> {
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
      child = spawn(command, args, { cwd, windowsHide: true });
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
    child.on('error', err => {
      resolveResult({
        exitCode: 1,
        summaryText: JSON.stringify({ ok: false, error: err.message, command, args, cwd }, null, 2),
      });
    });
    child.on('close', code => {
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

  return { command: process.platform === 'win32' ? 'OCRFlow.exe' : 'OCRFlow', baseArgs: ['--headless', 'parse'], cwd: appRoot };
}

function resolvePackagedExecutable(appRoot: string): string | null {
  const winExe = resolve(appRoot, '..', '..', 'OCRFlow.exe');
  if (process.platform === 'win32' && existsSync(winExe)) return winExe;

  const macExe = resolve(appRoot, '..', '..', 'MacOS', 'OCRFlow');
  if (process.platform === 'darwin' && existsSync(macExe)) return macExe;

  return null;
}

function cleanPath(value: string): string {
  return stripOuterQuotes(String(value).trim());
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
  const text = output.trim();
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
