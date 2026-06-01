import { readFileSync, createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import https from 'https';
import axios, { AxiosInstance } from 'axios';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { PROVIDER_LIMITS, ProviderType, ProviderLimits } from '../types';
import { IProvider, ParsedChunkResult, ProviderHealth } from './i-provider';

const streamPipeline = promisify(pipeline);

const AGENT_BASE = 'https://mineru.net/api/v1';
const PRECISION_BASE = 'https://mineru.net/api/v4';

let tlsRejectUnauthorized = true;

export function setMinerUTlsRejectUnauthorized(v: boolean): void {
  tlsRejectUnauthorized = v;
}

async function downloadFile(url: string, destPath: string, signal?: AbortSignal): Promise<void> {
  const parsedUrl = new URL(url);
  const options: https.RequestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    rejectUnauthorized: tlsRejectUnauthorized,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://mineru.net/',
    },
  };

  await new Promise<void>((resolve, reject) => {
    const req = https.get(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(res.headers.location, destPath, signal).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        reject(new Error('HTTP ' + String(res.statusCode)));
        return;
      }
      const file = createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { file.close(); reject(err); });
    });
    req.on('error', reject);
    if (signal) {
      signal.addEventListener('abort', () => { req.destroy(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }
    req.end();
  });
}

export class MinerUCloudProvider implements IProvider {
  readonly type: ProviderType = 'mineru-cloud';
  readonly limits: ProviderLimits = PROVIDER_LIMITS['mineru-cloud'];

  private precisionClient: AxiosInstance;
  private agentClient: AxiosInstance;
  private token: string;
  private useAgentOnly: boolean;
  private precisionQuotaExhausted: boolean = false;
  // Track which mode a task_id was submitted in, so poll/download use the right endpoint
  private agentTaskIds = new Set<string>();

  constructor(token: string) {
    this.token = token;
    this.useAgentOnly = !token;

    this.precisionClient = axios.create({
      baseURL: PRECISION_BASE,
      timeout: 300000,
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });

    this.agentClient = axios.create({
      baseURL: AGENT_BASE,
      timeout: 300000,
    });
  }

  updateToken(token: string): void {
    this.token = token;
    this.useAgentOnly = !token;
    this.precisionQuotaExhausted = false;
    if (token) {
      this.precisionClient.defaults.headers.common['Authorization'] = 'Bearer ' + token;
    } else {
      delete this.precisionClient.defaults.headers.common['Authorization'];
    }
  }

  canHandle(fileType: string): boolean {
    return this.limits.supportsFormats.includes(fileType as never);
  }

  getChunkSize(): number {
    if (this.token && !this.precisionQuotaExhausted) return 200;
    return 20;
  }

  async submit(chunkPath: string, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();

    var fileName = basename(chunkPath);
    var fileSize = 0;
    try {
      fileSize = statSync(chunkPath).size;
    } catch (e: any) {
      throw new Error('Unable to read file: ' + chunkPath + ' - ' + e.message);
    }

    console.log('[MinerU] Submit: ' + fileName + ' ' + (fileSize/1024/1024).toFixed(1) + 'MB token=' + !!this.token + ' agentOnly=' + this.useAgentOnly + ' quotaExhausted=' + this.precisionQuotaExhausted);

    if (this.token && !this.useAgentOnly && !this.precisionQuotaExhausted && fileSize <= 200 * 1024 * 1024) {
      console.log('[MinerU] -> Precision mode');
      return this.submitPrecision(chunkPath, fileName, fileSize, onProgress, signal);
    }

    if (fileSize > 10 * 1024 * 1024) {
      throw new Error('File too large (' + (fileSize/1024/1024).toFixed(1) + 'MB). Agent mode max 10MB. Please check if MinerU Token is valid.');
    }
    console.log('[MinerU] -> Agent mode');
    var taskId = await this.submitAgent(chunkPath, fileName, onProgress, signal);
    this.agentTaskIds.add(taskId);
    return taskId;
  }

  // ---- Precision (standard token-based API) ----

  private async submitPrecision(
    chunkPath: string, fileName: string, fileSize: number,
    onProgress?: (pct: number) => void, signal?: AbortSignal
  ): Promise<string> {
    signal?.throwIfAborted();
    if (onProgress) onProgress(5);

    console.log('[MinerU:Precision] Requesting upload URL for ' + fileName);
    var batchResp: any;
    try {
      batchResp = await this.precisionClient.post('/file-urls/batch', {
        files: [{ name: fileName, data_id: fileName }],
        model_version: 'vlm'
      }, signal ? { signal } : {});
    } catch (e: any) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') throw e;
      var code = e.response?.data?.code;
      if (code === '-60018') {
        this.precisionQuotaExhausted = true;
        console.log('[MinerU:Precision] Quota exhausted (-60018), falling back to Agent');
        if (fileSize > 10 * 1024 * 1024) {
          throw new Error('Precision quota exhausted and file exceeds Agent 10MB limit. Please wait for daily quota reset.');
        }
        var agentTaskId = await this.submitAgent(chunkPath, fileName, onProgress, signal);
        this.agentTaskIds.add(agentTaskId);
        return agentTaskId;
      }
      throw new Error('MinerU Precision upload request failed: ' + e.message + ' (HTTP ' + (e.response?.status || '?') + ')');
    }

    console.log('[MinerU:Precision] Full response body: ' + JSON.stringify(batchResp.data));

    var data = batchResp.data?.data;
    if (!data) {
      var _code = batchResp.data?.code;
      var msg = batchResp.data?.msg || batchResp.data?.message || 'Unknown error';
      throw new Error('MinerU Precision response error: code=' + _code + ' msg=' + msg);
    }

    var uploadUrl: string | undefined;
    var fileUrlsField: string[] = ['file_urls', 'urls', 'upload_urls', 'fileUrls', 'uploadUrls'];
    for (var _i = 0; _i < fileUrlsField.length; _i++) {
      var field = fileUrlsField[_i];
      var urls = (data as any)[field];
      if (Array.isArray(urls) && urls.length > 0) {
        if (typeof urls[0] === 'string') {
          uploadUrl = urls[0];
        } else if (typeof urls[0]?.url === 'string') {
          uploadUrl = urls[0].url;
        } else if (typeof urls[0]?.upload_url === 'string') {
          uploadUrl = urls[0].upload_url;
        }
        if (uploadUrl) break;
      }
    }
    if (!uploadUrl) {
      var respBody = JSON.stringify(batchResp.data);
      throw new Error('MinerU Precision: Failed to get upload URL. Response: ' + respBody);
    }

    var batchId = data.batch_id;
    console.log('[MinerU:Precision] Upload URL received, batch_id=' + batchId);

    signal?.throwIfAborted();
    if (onProgress) onProgress(30);
    console.log('[MinerU:Precision] Uploading file with native fetch...');

    var fileData = readFileSync(chunkPath);
    try {
      const fetchCtrl = new AbortController();
      const fetchTimer = setTimeout(() => fetchCtrl.abort(), 300000);

      if (signal) {
        signal.addEventListener('abort', () => fetchCtrl.abort(), { once: true });
      }

      var putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileData,
        signal: fetchCtrl.signal,
      });
      clearTimeout(fetchTimer);

      if (!putRes.ok) {
        var text = await putRes.text().catch(function() { return ''; });
        throw new Error('HTTP ' + putRes.status + (text ? ': ' + text : ''));
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw Object.assign(new Error('上传已取消或超时'), { name: 'AbortError' });
      }
      throw new Error('MinerU Precision file upload failed (' + e.message + ')');
    }
    console.log('[MinerU:Precision] Upload complete');

    signal?.throwIfAborted();
    if (onProgress) onProgress(80);
    console.log('[MinerU:Precision] Using batch_id=' + batchId + ' for polling');
    return batchId;
  }

  // ---- Agent (lightweight, no-token, signed-upload API) ----

  private async submitAgent(chunkPath: string, fileName: string, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (onProgress) onProgress(10);

    // Step 1: POST JSON to get signed upload URL + task_id
    console.log('[MinerU:Agent] Requesting signed upload URL for ' + fileName + '...');
    var step1Resp: any;
    try {
      step1Resp = await this.agentClient.post('/agent/parse/file', {
        file_name: fileName,
        language: 'ch',
      }, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
    } catch (e: any) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') throw e;
      throw new Error('MinerU Agent failed to get upload URL: ' + (e.response?.data?.msg || e.message));
    }

    var body = step1Resp.data;
    if (body.code !== 0) {
      throw new Error('MinerU Agent error (code ' + body.code + '): ' + (body.msg || 'unknown'));
    }

    var taskId = body.data?.task_id;
    var fileUrl = body.data?.file_url;
    if (!taskId || !fileUrl) {
      throw new Error('MinerU Agent: No task_id/file_url in response: ' + JSON.stringify(body));
    }
    console.log('[MinerU:Agent] task_id=' + taskId);

    signal?.throwIfAborted();
    if (onProgress) onProgress(30);

    // Step 2: PUT file to OSS signed URL.
    // OSS signed URLs embed auth in query string — do NOT add custom headers
    // (Content-Type etc.) that aren't part of the pre-signed signature.
    console.log('[MinerU:Agent] Uploading file to OSS (' + (statSync(chunkPath).size / 1024 / 1024).toFixed(1) + 'MB)...');
    try {
      const fileData = readFileSync(chunkPath);
      const fetchCtrl = new AbortController();
      const fetchTimer = setTimeout(() => fetchCtrl.abort(), 120000); // 2 min upload timeout
      if (signal) {
        signal.addEventListener('abort', () => fetchCtrl.abort(), { once: true });
      }

      const putRes = await fetch(fileUrl, {
        method: 'PUT',
        body: fileData,
        signal: fetchCtrl.signal,
      });
      clearTimeout(fetchTimer);

      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new Error('HTTP ' + putRes.status + (text ? ': ' + text : ''));
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || e.name === 'CanceledError') throw e;
      throw new Error('MinerU Agent OSS upload failed: ' + e.message);
    }

    console.log('[MinerU:Agent] File uploaded, task_id=' + taskId);
    if (onProgress) onProgress(80);
    return taskId;
  }

  // ---- Poll (works for both Precision batch_id and Agent task_id) ----

  async poll(taskId: string, signal?: AbortSignal): Promise<'done' | 'failed' | 'running' | 'pending'> {
    signal?.throwIfAborted();

    // Check if this is an Agent task ID
    if (this.agentTaskIds.has(taskId)) {
      return this.pollAgent(taskId, signal);
    }

    // Try Precision poll first if we have a token and quota is available
    if (this.token && !this.precisionQuotaExhausted) {
      try {
        var resp = await this.precisionClient.get('/extract-results/batch/' + taskId, signal ? { signal } : {});
        console.log('[MinerU:Poll:Precision] batch_id=' + taskId + ' response: ' + JSON.stringify(resp.data));

        var results = resp.data?.data?.extract_result;
        if (Array.isArray(results) && results.length > 0) {
          var r = results[0];
          var state = r.state;
          if (state === 'done') return 'done';
          if (state === 'failed') {
            console.log('[MinerU:Poll:Precision] failed: ' + (r.err_msg || ''));
            return 'failed';
          }
          if (state === 'running' || state === 'processing' || state === 'converting') return 'running';
          if (state === 'waiting' || state === 'pending' || state === 'waiting-file') return 'pending';
        }
        console.log('[MinerU:Poll:Precision] unexpected format, treating as pending');
        return 'pending';
      } catch (err: any) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') throw err;
        if (err.response?.status !== 404) {
          console.log('[MinerU:Poll] Precision poll error: ' + err.message);
        }
      }
    }

    // Fall back to Agent poll
    return this.pollAgent(taskId, signal);
  }

  private async pollAgent(taskId: string, signal?: AbortSignal): Promise<'done' | 'failed' | 'running' | 'pending'> {
    signal?.throwIfAborted();
    try {
      var resp = await this.agentClient.get('/agent/parse/' + taskId, signal ? { signal } : {});
      console.log('[MinerU:Poll:Agent] task_id=' + taskId + ' state=' + resp.data?.data?.state);
      var state = resp.data?.data?.state;

      if (state === 'done') return 'done';
      if (state === 'failed') {
        console.log('[MinerU:Poll:Agent] failed: ' + (resp.data?.data?.err_msg || ''));
        return 'failed';
      }
      if (state === 'running' || state === 'processing') return 'running';
      if (state === 'waiting-file' || state === 'pending' || state === 'waiting' || state === 'uploading') return 'pending';
      console.log('[MinerU:Poll:Agent] unknown state: ' + state);
      return 'pending';
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') throw err;
      console.log('[MinerU:Poll] Agent poll error: ' + err.message);
      return 'pending';
    }
  }

  // ---- Download (works for both Precision and Agent) ----

  async download(taskId: string, destDir: string, signal?: AbortSignal): Promise<ParsedChunkResult> {
    signal?.throwIfAborted();
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    // Agent download
    if (this.agentTaskIds.has(taskId)) {
      return this.downloadAgent(taskId, destDir, signal);
    }

    // Precision download
    if (this.token && !this.precisionQuotaExhausted) {
      var httpError: string | undefined;
      try {
        var _resp = await this.precisionClient.get('/extract-results/batch/' + taskId, signal ? { signal } : {});
        var respBody = _resp.data;
        console.log('[MinerU:Download:Precision] batch_id=' + taskId + ' response: ' + JSON.stringify(respBody));
        var _results = respBody?.data;
        var resultList = _results?.extract_result;
        if (Array.isArray(resultList) && resultList.length > 0) {
          var _r = resultList[0];
          var zipUrl = _r.full_zip_url || _r.zip_url || _r.download_url || _r.result_url
            || _r.fullZipUrl || _r.zipUrl || _r.downloadUrl;
          if (zipUrl) {
            var destPath = join(destDir, taskId + '.zip');
            console.log('[MinerU:Download] Fetching zip from ' + zipUrl.substring(0, 80) + '...');
            await downloadFile(zipUrl, destPath, signal);
            return { rawPath: destPath };
          }
          var dataZipUrl = _results?.full_zip_url || _results?.zip_url;
          if (dataZipUrl) {
            var destPath2 = join(destDir, taskId + '.zip');
            await downloadFile(dataZipUrl, destPath2, signal);
            return { rawPath: destPath2 };
          }
          throw new Error(
            'Precision result has no download link. extract_result keys: ' +
            JSON.stringify(Object.keys(_r))
          );
        }
        throw new Error('Precision response missing extract_result array');
      } catch (err: any) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') throw err;
        httpError = err.message;
        if (err.message?.includes('Precision result has no download link') || err.message?.includes('Precision response missing extract_result')) {
          throw err;
        }
        console.log('[MinerU:Download:Precision] error: ' + err.message);
      }
    }

    // Fall back to Agent download
    return this.downloadAgent(taskId, destDir, signal);
  }

  private async downloadAgent(taskId: string, destDir: string, signal?: AbortSignal): Promise<ParsedChunkResult> {
    signal?.throwIfAborted();
    try {
      var resp = await this.agentClient.get('/agent/parse/' + taskId, signal ? { signal } : {});
      console.log('[MinerU:Download:Agent] response state=' + resp.data?.data?.state);
      var mdUrl = resp.data?.data?.markdown_url;
      if (mdUrl) {
        var destPath = join(destDir, taskId + '.md');
        var downloadResp = await axios.get(mdUrl, {
          responseType: 'stream',
          ...(signal ? { signal } : {}),
        });
        const writer = createWriteStream(destPath);
        await streamPipeline(downloadResp.data, writer);
        return { rawPath: destPath, markdown: readFileSync(destPath, 'utf-8') };
      }

      // Try content_url as fallback
      var contentUrl = resp.data?.data?.content_url;
      if (contentUrl) {
        var contentPath = join(destDir, taskId + '.md');
        var contentResp = await axios.get(contentUrl, {
          responseType: 'text',
          ...(signal ? { signal } : {}),
        });
        return { rawPath: contentPath, markdown: contentResp.data };
      }

      throw new Error('No markdown_url in Agent response');
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') throw err;
      throw new Error('Agent download failed: ' + (err.response?.data?.data?.err_msg || err.message));
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Reset stale quota flag on every health check so daily-reset recovery works.
    // If the API still returns quota-exhausted, we'll re-set it below.
    this.precisionQuotaExhausted = false;

    // Check basic network connectivity first
    try {
      await axios.get('https://mineru.net', { timeout: 5000 });
    } catch (_e) {
      return { available: false, message: '无法连接 MinerU 服务器' };
    }

    // No token → Agent mode only
    if (!this.token || this.useAgentOnly) {
      return { available: true, message: 'Agent 模式（免登录，≤10MB/20页）' };
    }

    // Token is set → test Precision API auth
    try {
      var resp = await this.precisionClient.get('/extract-results/batch/_health_check', {
        timeout: 10000,
        validateStatus: function(s) { return s < 500; },
      });

      // 401/403 → bad token
      if (resp.status === 401 || resp.status === 403) {
        return { available: false, message: 'Token 无效或已过期' };
      }

      var code = resp.data?.code;
      if (code === 'A0202' || code === 'A0211') {
        return { available: false, message: 'Token 无效或已过期' };
      }
      if (code === '-60018') {
        this.precisionQuotaExhausted = true;
        return { available: true, message: 'Precision 配额已用完 → 已切换 Agent' };
      }

      // 404 is expected (fake ID), 200 means endpoint responded = token works
      return { available: true, message: 'Precision 模式（≤200页/200MB）' };
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        return { available: false, message: 'Precision API 不可达: ' + (err.message || '') };
      }
      if (err.response?.status === 401 || err.response?.status === 403) {
        return { available: false, message: 'Token 无效或已过期' };
      }
      // Other errors (DNS, network, etc.) → token might still be valid, API just down
      return { available: true, message: 'Precision 模式（≤200页/200MB）— API 响应异常，可尝试提交' };
    }
  }
}
