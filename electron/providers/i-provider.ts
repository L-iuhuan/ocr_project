import { FileInfo, Chunk, ProviderLimits, ProviderType, Task, OutputFormat } from '../types';

export interface ParsedChunkResult {
  markdown?: string;
  json?: Record<string, unknown>;
  images?: Record<string, string>;
  rawPath?: string;
}

export interface ProviderHealth {
  available: boolean;
  message: string;
}

export interface IProvider {
  readonly type: ProviderType;
  readonly limits: ProviderLimits;

  /** Submit a chunk to the provider API, returns task/batch ID.
   *  Pass signal to allow cancellation of in-flight HTTP requests. */
  submit(chunkPath: string, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<string>;

  /** Poll task status. Returns 'done', 'failed', 'running', or 'pending'.
   *  Pass signal to allow cancellation of in-flight HTTP requests. */
  poll(taskId: string, signal?: AbortSignal): Promise<'done' | 'failed' | 'running' | 'pending'>;

  /** Download result to local directory.
   *  Pass signal to allow cancellation of in-flight HTTP requests. */
  download(taskId: string, destDir: string, signal?: AbortSignal): Promise<ParsedChunkResult>;

  /** Health check */
  healthCheck(): Promise<ProviderHealth>;

  /** Whether this provider can handle this file format */
  canHandle(fileType: string): boolean;

  /** Get chunk size (pages per chunk) for this provider */
  getChunkSize(): number;
}
