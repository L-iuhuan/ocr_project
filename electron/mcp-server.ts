import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const inputSchema = {
  paths: z.array(z.string().min(1)).min(1).describe('Local file or folder paths to parse'),
  outputDir: z.string().min(1).optional().describe('Optional output directory for this run'),
  provider: z.enum(['auto', 'mineru-cloud', 'paddleocr-cloud', 'paddleocr-local']).optional().describe('Optional single provider override'),
  providers: z.array(z.enum(['mineru-cloud', 'paddleocr-cloud', 'paddleocr-local'])).optional().describe('Optional provider fallback order'),
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

async function main(): Promise<void> {
  const server = new McpServer({ name: 'ocrflow', version: '1.1.2' });

  server.registerTool(
    'parse_documents',
    {
      title: 'Parse documents with OCRFlow',
      description: 'Batch parse local PDF/Office/image files or folders using OCRFlow GUI settings. Writes Markdown outputs to disk and returns a JSON summary.',
      inputSchema,
    },
    async (input: any) => {
      const result = await runOcrflowCli(input as ParseInput);
      return {
        isError: result.exitCode !== 0,
        content: [{ type: 'text' as const, text: result.summaryText }],
      };
    },
  );

  await server.connect(new StdioServerTransport());
}

function runOcrflowCli(input: ParseInput): Promise<{ exitCode: number; summaryText: string }> {
  const { command, baseArgs } = resolveOcrflowCommand();
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

  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { cwd: process.cwd(), windowsHide: true });
    } catch (err: any) {
      resolve({
        exitCode: 1,
        summaryText: JSON.stringify({ ok: false, error: err.message || String(err), command, args }, null, 2),
      });
      return;
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', err => {
      resolve({
        exitCode: 1,
        summaryText: JSON.stringify({ ok: false, error: err.message, command, args }, null, 2),
      });
    });
    child.on('close', code => {
      const parsed = extractJson(stdout);
      if (parsed) {
        resolve({ exitCode: code ?? 1, summaryText: JSON.stringify(parsed, null, 2) });
        return;
      }
      resolve({
        exitCode: code ?? 1,
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

function resolveOcrflowCommand(): { command: string; baseArgs: string[] } {
  const explicit = process.env.OCRFLOW_COMMAND;
  if (explicit) {
    return { command: explicit, baseArgs: ['--headless', 'parse'] };
  }

  const electronPackage = join(process.cwd(), 'node_modules', 'electron');
  if (existsSync(electronPackage)) {
    const electronBinary = require('electron') as string;
    return { command: electronBinary, baseArgs: ['.', '--headless', 'parse'] };
  }

  return { command: process.platform === 'win32' ? 'OCRFlow.exe' : 'OCRFlow', baseArgs: ['--headless', 'parse'] };
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

main().catch(err => {
  process.stderr.write('[ocrflow-mcp] ' + (err.message || String(err)) + '\n');
  process.exit(1);
});
