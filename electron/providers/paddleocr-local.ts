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
    const root = raw?.result || raw?.data || raw;
    const chunks: string[] = [];
    const images: Record<string, string> = {};

    // 1) Direct markdown/text style responses used by many lightweight services.
    pushText(chunks, root?.markdown || root?.md || root?.text || raw?.markdown || raw?.md || raw?.text);
    pushText(chunks, raw?.choices?.[0]?.message?.content || raw?.choices?.[0]?.text);

    // 2) MinerU / PaddleOCR / AIStudio layoutParsingResults.
    const layoutResults = root?.layoutParsingResults || raw?.layoutParsingResults || [];
    for (const item of layoutResults) {
      const beforeCount = chunks.length;
      const markdown = item?.markdown;
      pushText(chunks, typeof markdown === 'string' ? markdown : markdown?.text);
      if (markdown?.images && typeof markdown.images === 'object') Object.assign(images, markdown.images);

      const parsingList = item?.prunedResult?.parsing_res_list || item?.parsing_res_list || item?.blocks;
      if (chunks.length === beforeCount && Array.isArray(parsingList)) {
        const lines = parsingList.map((block: any) => normalizeBlockContent(block)).filter(Boolean);
        if (lines.length > 0) chunks.push(lines.join('\n\n'));
      }
      if (item?.outputImages && typeof item.outputImages === 'object') Object.assign(images, item.outputImages);
    }

    // 3) Traditional OCR arrays: results, ocr_result, rec_texts, blocks, pages.
    for (const list of [root?.results, root?.ocr_result, root?.rec_texts, root?.blocks, root?.pages]) {
      if (!Array.isArray(list)) continue;
      const lines = list.map((item: any) => normalizeBlockContent(item)).filter(Boolean);
      if (lines.length > 0) chunks.push(lines.join('\n\n'));
    }

    // 4) Last-resort recursive scan for common text fields.
    if (chunks.length === 0) {
      const found = collectTextFields(root, 0);
      if (found.length > 0) chunks.push(found.join('\n\n'));
    }

    return {
      markdown: chunks.filter(Boolean).join('\n\n---\n\n'),
      json: root || {},
      images
    };
  }
}

function pushText(chunks: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim()) chunks.push(value.trim());
}

function normalizeBlockContent(block: any): string {
  if (typeof block === 'string') return block.trim();
  const content = String(
    block?.block_content ?? block?.text ?? block?.content ?? block?.markdown ??
    block?.rec_text ?? block?.recText ?? block?.transcription ?? block?.value ?? ''
  ).trim();
  if (!content) return '';
  const label = String(block?.block_label || block?.type || block?.label || '').toLowerCase();
  if (label.includes('title')) return '## ' + content;
  if (label === 'formula' || label.includes('equation')) return '$$\n' + content + '\n$$';
  return content;
}

function collectTextFields(value: any, depth: number): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === 'string') return value.trim().length > 20 ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(item => collectTextFields(item, depth + 1));
  if (typeof value !== 'object') return [];

  const hits: string[] = [];
  for (const key of Object.keys(value)) {
    const lower = key.toLowerCase();
    if (['markdown', 'md', 'text', 'content', 'block_content', 'rec_text', 'transcription'].includes(lower)) {
      const text = value[key];
      if (typeof text === 'string' && text.trim()) hits.push(text.trim());
    } else if (!['image', 'images', 'outputimages', 'inputimage', 'bbox', 'block_bbox'].includes(lower)) {
      hits.push(...collectTextFields(value[key], depth + 1));
    }
  }
  return Array.from(new Set(hits));
}
