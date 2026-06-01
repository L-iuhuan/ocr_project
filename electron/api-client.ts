import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const RETRY_MAX = 3;
const MAX_RETRIES_POST = 1; // POST requests should rarely be retried

export class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL?: string) {
    this.client = axios.create({
      baseURL,
      timeout: 120000
    });
  }

  setBaseURL(url: string): void {
    this.client.defaults.baseURL = url;
  }

  setToken(token: string): void {
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.retryRequest(() => this.client.get<T>(url, config), 'GET');
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    // POST requests have limited retries to avoid double-submission
    return this.retryRequest(
      () => this.client.post<T>(url, data, {
        ...config,
        timeout: config?.timeout || 300000, // 5 min default for uploads
      }),
      'POST'
    );
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.retryRequest(() => this.client.put<T>(url, data, config), 'PUT');
  }

  private async retryRequest<T>(
    fn: () => Promise<{ data: T }>,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    retries = 0
  ): Promise<T> {
    try {
      const resp = await fn();
      return resp.data;
    } catch (err: any) {
      const status = err.response?.status;
      const code = err.response?.data?.code;

      // Determine max retries based on HTTP method
      const maxRetries = method === 'GET' ? RETRY_MAX : MAX_RETRIES_POST;

      if (status === 429) {
        // Rate limited — use Retry-After header if available, otherwise 30s
        const retryAfter = err.response?.headers?.['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
        await sleep(Math.min(waitMs, 60000)); // Cap at 60s
        if (retries < maxRetries) return this.retryRequest(fn, method, retries + 1);
      }

      // Only retry on transient server errors (5xx) and specific transient codes
      if (status === 503 || status === 504 || code === '-60009' || code === '-60010') {
        if (retries < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s, ...
          const delay = Math.pow(2, retries) * 1000;
          await sleep(delay);
          return this.retryRequest(fn, method, retries + 1);
        }
      }

      // For connection errors (ECONNREFUSED, etc.), retry with backoff
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        if (retries < maxRetries) {
          const delay = Math.pow(2, retries) * 1000;
          await sleep(delay);
          return this.retryRequest(fn, method, retries + 1);
        }
      }

      throw err;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
