import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join } from 'path';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { PROVIDER_LIMITS, ProviderType, ProviderLimits } from '../types';
import { IProvider, ParsedChunkResult, ProviderHealth } from './i-provider';

const API_BASE = 'https://paddleocr.aistudio-app.com/api/v2/ocr';
const MODEL = 'PaddleOCR-VL-1.6';
const POLL_INTERVAL_MS = 5000;

export class PaddleOCRCloudProvider implements IProvider {
  readonly type: ProviderType = 'paddleocr-cloud';
  readonly limits: ProviderLimits = PROVIDER_LIMITS['paddleocr-cloud'];

  private token: string;
  private client: AxiosInstance;

  constructor(token: string) {
    this.token = token;
    this.client = axios.create({
      baseURL: API_BASE,
      timeout: 300000,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  }

  updateToken(token: string): void {
    this.token = token;
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.client.defaults.headers.common['Authorization'];
    }
  }

  canHandle(fileType: string): boolean {
    return this.limits.supportsFormats.includes(fileType as never);
  }

  getChunkSize(): number {
    return this.limits.maxPages;
  }

  async submit(chunkPath: string, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!this.token) throw new Error('Baidu PaddleOCR Token 未配置');

    const fileName = basename(chunkPath);
    if (onProgress) onProgress(10);

    // Check if file is a URL or local path
    if (chunkPath.startsWith('http://') || chunkPath.startsWith('https://')) {
      // URL mode
      const payload = {
        fileUrl: chunkPath,
        model: MODEL,
        optionalPayload: {}
      };
      const resp = await this.client.post('/jobs', payload, {
        headers: { 'Content-Type': 'application/json' },
        ...(signal ? { signal } : {}),
      });
      const jobId = resp.data.data.jobId;
      if (!jobId) throw new Error(`提交失败: ${JSON.stringify(resp.data)}`);
      if (onProgress) onProgress(40);
      return jobId;
    }

    // Local file mode
    if (!existsSync(chunkPath)) throw new Error(`文件不存在: ${chunkPath}`);

    const fileData = readFileSync(chunkPath);
    const formData = new FormData();
    formData.append('file', fileData, fileName);
    formData.append('model', MODEL);
    formData.append('optionalPayload', JSON.stringify({}));

    if (onProgress) onProgress(20);

    const resp = await this.client.post('/jobs', formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${this.token}`
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600000,
      ...(signal ? { signal } : {}),
    });

    signal?.throwIfAborted();
    if (onProgress) onProgress(40);

    const jobId = resp.data.data.jobId;
    if (!jobId) throw new Error(`提交失败: ${JSON.stringify(resp.data)}`);

    return jobId;
  }

  async poll(taskId: string, signal?: AbortSignal): Promise<'done' | 'failed' | 'running' | 'pending'> {
    signal?.throwIfAborted();
    if (!this.token) return 'failed';

    try {
      const resp = await this.client.get(`/jobs/${taskId}`, signal ? { signal } : {});
      const state = resp.data.data.state;

      if (state === 'done') return 'done';
      if (state === 'failed') return 'failed';
      if (state === 'running') return 'running';
      return 'pending';
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') throw err;
      if (err.response?.status === 404) return 'failed';
      throw err;
    }
  }

  async download(taskId: string, destDir: string, signal?: AbortSignal): Promise<ParsedChunkResult> {
    signal?.throwIfAborted();
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    // Get job result to find resultUrl
    const jobResp = await this.client.get(`/jobs/${taskId}`, signal ? { signal } : {});
    const jobData = jobResp.data.data;

    if (jobData.state !== 'done') {
      throw new Error(`任务未完成: ${jobData.state}`);
    }

    const jsonlUrl = jobData.resultUrl?.jsonUrl;
    if (!jsonlUrl) {
      throw new Error('未找到结果下载链接');
    }

    // Download JSONL result
    const jsonlResp = await axios.get(jsonlUrl, {
      responseType: 'text',
      ...(signal ? { signal } : {}),
    });
    const lines = jsonlResp.data.trim().split('\n').filter((l: string) => l.trim());

    let markdown = '';
    let jsonResult: any = null;
    const images: Record<string, string> = {};

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const result = parsed.result;
        if (!result) continue;

        const layoutResults = result.layoutParsingResults || [];
        for (const res of layoutResults) {
          // Extract markdown
          if (res.markdown?.text) {
            markdown += res.markdown.text + '\n\n---\n\n';
          }

          // Extract images from both markdown.images and outputImages
          if (res.markdown?.images && typeof res.markdown.images === 'object') {
            Object.assign(images, res.markdown.images);
          }
          if (res.outputImages && typeof res.outputImages === 'object') {
            Object.assign(images, res.outputImages);
          }

          // Save JSON
          if (!jsonResult) jsonResult = result;
        }
      } catch (e: any) { console.warn('[PaddleOCR] 跳过格式异常的行: ' + (e.message || e)); }
    }

    signal?.throwIfAborted();

    // Save markdown to file
    const mdPath = join(destDir, `${taskId}.md`);
    writeFileSync(mdPath, markdown, 'utf-8');

    return { markdown, json: jsonResult, images, rawPath: mdPath };
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.token) {
      return { available: false, message: 'Token 未配置。请从 PaddleOCR 官网获取 Token。' };
    }
    try {
      // Test API reachability + token validity by hitting the jobs endpoint.
      // The GET returns 404 if no job exists (expected), but 401/403 if the token
      // is invalid. A 404 proves both network reachability AND correct Authorization header.
      const resp = await this.client.get('/jobs', {
        timeout: 8000,
        validateStatus: (s) => s < 500,
      });
      if (resp.status === 401 || resp.status === 403) {
        return { available: false, message: 'Token 无效或已过期。请从 PaddleOCR 官网重新获取。' };
      }
      // 200 or 404 both mean the API is reachable and token was accepted
      return { available: true, message: 'OK (20,000 页/天, PaddleOCR-VL-1.6)' };
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        return { available: false, message: 'Token 无效或已过期。请从 PaddleOCR 官网重新获取。' };
      }
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        return { available: false, message: `网络连接失败: ${err.message}` };
      }
      return { available: false, message: `服务暂时不可用: ${err.message}` };
    }
  }
}
