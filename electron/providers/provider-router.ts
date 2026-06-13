import { ProviderType, ProviderStatus, FileInfo, Task, Chunk, OutputFormat } from '../types';
import { IProvider } from './i-provider';
import { getAvailableProviders, canProviderHandle } from './provider-registry';
import { generateJobId } from '../state-manager';

export interface RoutedTask {
  provider: IProvider;
  file: FileInfo;
}

/**
 * Route a file to the best available provider based on priority and health status.
 *
 * The providerStatuses parameter is a snapshot taken at the time of routing.
 * Callers should ensure it is reasonably fresh (e.g., obtained within the same
 * request handler, not cached across sessions).
 */
export async function routeTask(
  file: FileInfo,
  priority: ProviderType[],
  providerStatuses: ProviderStatus[]
): Promise<{ provider: IProvider | null; reason?: string }> {
  const available = getAvailableProviders(priority);
  const skipped: string[] = [];

  for (const provider of available) {
    const status = providerStatuses.find(s => s.type === provider.type);

    // Check if provider is healthy (snapshot data)
    if (status && !status.available) {
      skipped.push(`${provider.type}(${status.lastError || '不可用'})`);
      continue;
    }
    if (status && status.quotaExhausted) {
      skipped.push(`${provider.type}(配额已用完)`);
      continue;
    }

    // Check if provider supports this file type
    if (!canProviderHandle(provider.type, file.type)) {
      skipped.push(`${provider.type}(不支持 ${file.type} 格式)`);
      continue;
    }

    return { provider };
  }

  const reason = available.length === 0
    ? '无已注册的 Provider，请检查服务商设置'
    : '跳过原因: ' + skipped.join('; ');
  return { provider: null, reason };
}

export function buildTaskFromFile(
  file: FileInfo,
  chunks: Chunk[],
  provider: IProvider,
  outputDir: string,
  outputFormats: OutputFormat[],
  jobId?: string,
): Task {
  const now = Date.now();
  return {
    jobId: jobId || generateJobId(),
    originalName: file.name,
    sourcePaths: [file.path],
    fileType: file.type,
    fileSize: file.sizeBytes,
    pageCount: file.pageCount,
    outputFormats,
    outputDir,
    state: 'pending',
    progress: 0,
    chunks,
    retryCount: 0,
    providerUsed: provider.type,
    createdAt: now,
    elapsed: 0
  };
}
