import axios from 'axios';
import { PROVIDER_LIMITS, ProviderType, ProviderLimits } from '../types';
import { IProvider, ParsedChunkResult, ProviderHealth } from './i-provider';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { pythonBridge } from '../python-bridge';

export class PaddleOCRLocalProvider implements IProvider {
  readonly type: ProviderType = 'paddleocr-local';
  readonly limits: ProviderLimits = PROVIDER_LIMITS['paddleocr-local'];

  private enabled: boolean = false;
  private port: number = 51987;
  private pythonPath: string = process.platform === 'darwin' ? 'python3' : 'python';
  private results = new Map<string, ParsedChunkResult>();
  private readonly MAX_STORED_RESULTS = 20;

  configure(enabled: boolean, port: number, pythonPath?: string): void {
    this.pythonPath = pythonPath || (process.platform === 'darwin' ? 'python3' : 'python');
    this.enabled = enabled;
    this.port = port;
    // Clear stale results when settings change
    this.results.clear();
  }

  canHandle(fileType: string): boolean {
    return this.limits.supportsFormats.includes(fileType as never);
  }

  getChunkSize(): number {
    return this.limits.maxPages;
  }

  async submit(chunkPath: string, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!this.enabled) {
      throw new Error('本地 OCR 引擎未启用。请在设置中配置。');
    }
    if (!existsSync(chunkPath)) {
      throw new Error(`文件不存在: ${chunkPath}`);
    }

    if (onProgress) onProgress(10);
    if (!pythonBridge.isRunning()) {
      await pythonBridge.start(this.pythonPath, this.port);
    }

    signal?.throwIfAborted();
    if (onProgress) onProgress(35);
    const raw = await pythonBridge.parse(chunkPath, signal);
    const parsed = this.normalizeLocalResult(raw);
    const taskId = randomUUID();

    // Cap stored results to prevent memory leaks from cancelled tasks
    if (this.results.size >= this.MAX_STORED_RESULTS) {
      const oldest = this.results.keys().next().value;
      if (oldest) this.results.delete(oldest);
    }
    this.results.set(taskId, parsed);
    if (onProgress) onProgress(90);
    return taskId;
  }

  async poll(taskId: string, signal?: AbortSignal): Promise<'done' | 'failed' | 'running' | 'pending'> {
    signal?.throwIfAborted();
    return this.results.has(taskId) ? 'done' : 'failed';
  }

  async download(taskId: string, destDir: string, signal?: AbortSignal): Promise<ParsedChunkResult> {
    signal?.throwIfAborted();
    const result = this.results.get(taskId);
    if (!result) {
      throw new Error('未找到本地 OCR 结果');
    }

    // Clean up from memory to prevent unbounded growth
    this.results.delete(taskId);

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    signal?.throwIfAborted();

    const mdPath = join(destDir, `${taskId}.md`);
    writeFileSync(mdPath, result.markdown || '', 'utf-8');

    const jsonPath = join(destDir, `${taskId}.json`);
    writeFileSync(jsonPath, JSON.stringify(result.json || {}, null, 2), 'utf-8');

    return { ...result, rawPath: mdPath };
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.enabled) {
      return { available: false, message: '本地 OCR 未启用' };
    }
    try {
      const resp = await axios.get(`http://127.0.0.1:${this.port}/health`, { timeout: 2000 });
      if (resp.status === 200) {
        return { available: true, message: `本地 OCR 已运行 (端口 ${this.port})` };
      }
    } catch {}

    if (pythonBridge.isRunning()) {
      const ok = await pythonBridge.healthCheck();
      return { available: ok, message: ok ? `本地 OCR 已运行 (端口 ${pythonBridge.getPort()})` : '本地 OCR 服务未响应' };
    }
    const env = await pythonBridge.checkEnvironment(this.pythonPath);
    if (!env.pythonInstalled) {
      return { available: false, message: `未找到 Python: ${this.pythonPath}` };
    }
    if (!env.paddleocrInstalled) {
      return { available: true, message: `${env.pythonVersion}; PaddleOCR 未安装，首次提交会返回安装提示` };
    }
    return { available: true, message: `${env.pythonVersion}; PaddleOCR 可用` };
  }

  private normalizeLocalResult(raw: any): ParsedChunkResult {
    const root = raw?.result || raw;
    const layoutResults = root?.layoutParsingResults || [];
    const chunks: string[] = [];
    const images: Record<string, string> = {};

    for (const item of layoutResults) {
      const beforeCount = chunks.length;
      const markdown = item?.markdown;
      if (typeof markdown === 'string') {
        chunks.push(markdown);
      } else if (typeof markdown?.text === 'string') {
        chunks.push(markdown.text);
      }
      if (markdown?.images && typeof markdown.images === 'object') {
        Object.assign(images, markdown.images);
      }

      // External PaddleOCR/MinerU-compatible local services may return only
      // prunedResult.parsing_res_list, not markdown.text.
      const parsingList = item?.prunedResult?.parsing_res_list;
      if (chunks.length === beforeCount && Array.isArray(parsingList)) {
        const lines = parsingList
          .map((block: any) => normalizeBlockContent(block))
          .filter(Boolean);
        if (lines.length > 0) chunks.push(lines.join('\n\n'));
      }
      if (item?.outputImages && typeof item.outputImages === 'object') {
        Object.assign(images, item.outputImages);
      }
    }

    return {
      markdown: chunks.filter(Boolean).join('\n\n---\n\n'),
      json: root || {},
      images
    };
  }
}

function normalizeBlockContent(block: any): string {
  const content = String(block?.block_content || '').trim();
  if (!content) return '';
  const label = String(block?.block_label || '').toLowerCase();
  if (label.includes('title')) return '## ' + content;
  if (label === 'formula') return '$$\n' + content + '\n$$';
  return content;
}
