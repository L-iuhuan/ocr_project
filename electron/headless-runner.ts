import { existsSync } from 'fs';
import { resolve } from 'path';
import { AppSettings, ProviderStatus, ProviderType, Task } from './types';
import { HeadlessParseOptions } from './headless-args';
import { scanFiles } from './pipeline/scanner';
import { analyzeFiles } from './pipeline/preprocessor';
import { splitFileByProvider } from './pipeline/splitter';
import { routeTask, buildTaskFromFile } from './providers/provider-router';
import { registerProvider } from './providers/provider-registry';
import { MinerUCloudProvider } from './providers/mineru-cloud';
import { PaddleOCRCloudProvider } from './providers/paddleocr-cloud';
import { PaddleOCRLocalProvider } from './providers/paddleocr-local';
import { loadSettings } from './state-manager';
import { taskWorker } from './task-worker';
import { pythonBridge } from './python-bridge';

export interface HeadlessSummary {
  ok: boolean;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  skipped: string[];
  tasks: Array<{ jobId: string; originalName: string; state: string; outputDir: string; errorMsg?: string }>;
}

export async function runHeadlessParse(options: HeadlessParseOptions): Promise<{ code: number; summary: HeadlessSummary }> {
  const settings = applyOverrides(loadSettings(), options);
  const log = (message: string) => {
    if (!options.json) console.log(message);
  };

  const providers = bootstrapProviders(settings);
  taskWorker.configure({
    onUpdate: () => {},
    onLog: entry => log(formatLog(entry.level, entry.message, entry.jobId)),
    onProgress: progress => {
      if (!options.json && progress.total > 0) {
        process.stdout.write(`\r进度: ${progress.completed + progress.failed}/${progress.total} 任务, ${progress.chunkCompleted}/${progress.chunkTotal} 分块`);
      }
    },
  }, { persistTasks: false, settingsProvider: () => settings });
  taskWorker.setConcurrency(settings.concurrency);
  taskWorker.setProviderPriority(settings.providerPriority);

  const inputPaths = options.paths.map(p => resolve(p));
  const missing = inputPaths.filter(p => !existsSync(p));
  const existing = inputPaths.filter(p => existsSync(p));
  if (missing.length > 0) missing.forEach(p => log('路径不存在，跳过: ' + p));
  if (existing.length === 0) {
    return { code: 2, summary: emptySummary([...missing.map(p => '路径不存在: ' + p), '没有可用输入路径']) };
  }

  log('扫描文件...');
  const files = scanFiles(existing);
  if (files.length === 0) {
    return { code: 2, summary: emptySummary(['未找到支持的文件格式']) };
  }

  log('分析文件: ' + files.length);
  const analyzed = await analyzeFiles(files);
  const valid = analyzed.filter(f => f.pageCount > 0);
  if (valid.length === 0) {
    return { code: 2, summary: emptySummary(['文件页数分析失败']) };
  }

  const providerStatuses = await getProviderStatuses(providers, log);
  const tasks: Task[] = [];
  const skipped: string[] = [...missing.map(p => '路径不存在: ' + p)];

  for (const file of valid) {
    const route = await routeTask(file, settings.providerPriority, providerStatuses);
    if (!route.provider) {
      skipped.push(file.name + ': ' + (route.reason || '没有可用 Provider'));
      continue;
    }
    const providerChunkSize = route.provider.getChunkSize();
    const effectiveChunkSize = Math.min(settings.chunkSize || providerChunkSize, providerChunkSize);
    log('路由: ' + file.name + ' → ' + route.provider.type + ' (' + file.pageCount + '页)');
    const split = await splitFileByProvider(file, route.provider.type, effectiveChunkSize);
    const task = buildTaskFromFile(file, split.chunks, route.provider, settings.outputDir, settings.outputFormats);
    tasks.push(task);
  }

  if (tasks.length === 0) {
    const hint = '没有可处理任务。请先打开 OCRFlow GUI 配置 Token，或使用 MinerU Agent 支持的小文件。';
    return { code: 3, summary: emptySummary([...skipped, hint]) };
  }

  log('开始处理 ' + tasks.length + ' 个任务...');
  const resultTasks = await taskWorker.runTasksOnce(tasks);
  if (!options.json) process.stdout.write('\n');

  const completed = resultTasks.filter(t => t.state === 'done').length;
  const failed = resultTasks.filter(t => t.state === 'failed').length;
  const cancelled = resultTasks.filter(t => t.state === 'cancelled').length;
  const summary: HeadlessSummary = {
    ok: failed === 0 && cancelled === 0,
    total: resultTasks.length,
    completed,
    failed,
    cancelled,
    skipped,
    tasks: resultTasks.map(t => ({
      jobId: t.jobId,
      originalName: t.originalName,
      state: t.state,
      outputDir: t.outputDir,
      errorMsg: t.errorMsg,
    })),
  };

  log('完成: ' + completed + ' 成功, ' + failed + ' 失败, ' + cancelled + ' 取消');
  return { code: summary.ok ? 0 : 1, summary };
}

export async function stopHeadlessServices(): Promise<void> {
  await pythonBridge.stop();
}

function applyOverrides(settings: AppSettings, options: HeadlessParseOptions): AppSettings {
  const next: AppSettings = {
    ...settings,
    providers: {
      ...settings.providers,
      mineruCloud: { ...settings.providers.mineruCloud },
      paddleocrCloud: { ...settings.providers.paddleocrCloud },
      paddleocrLocal: { ...settings.providers.paddleocrLocal },
    },
    outputFormats: ['md'],
  };
  if (options.outputDir) next.outputDir = options.outputDir;
  if (options.concurrency) next.concurrency = Math.max(1, Math.min(8, Math.round(options.concurrency)));
  if (options.chunkSize) next.chunkSize = Math.max(1, Math.round(options.chunkSize));
  if (options.providers && options.providers.length > 0) {
    next.providerPriority = [...new Set(options.providers)];
  }
  return next;
}

function bootstrapProviders(settings: AppSettings) {
  const mineruCloud = new MinerUCloudProvider(settings.providers.mineruCloud.token);
  const paddleocrCloud = new PaddleOCRCloudProvider(settings.providers.paddleocrCloud.token);
  const paddleocrLocal = new PaddleOCRLocalProvider();
  paddleocrLocal.configure(
    settings.providers.paddleocrLocal.enabled,
    settings.providers.paddleocrLocal.port,
    settings.providers.paddleocrLocal.pythonPath,
  );

  registerProvider(mineruCloud);
  registerProvider(paddleocrCloud);
  registerProvider(paddleocrLocal);

  pythonBridge.setLogCallback(entry => {
    if (entry.level === 'error') console.error('[Python OCR] ' + entry.message);
    else console.log('[Python OCR] ' + entry.message);
  });

  return { mineruCloud, paddleocrCloud, paddleocrLocal };
}

async function getProviderStatuses(
  providers: ReturnType<typeof bootstrapProviders>,
  log: (message: string) => void,
): Promise<ProviderStatus[]> {
  const statuses: ProviderStatus[] = [];
  for (const provider of [providers.mineruCloud, providers.paddleocrCloud, providers.paddleocrLocal]) {
    const health = await provider.healthCheck().catch(err => ({ available: false, message: err.message || '检测失败' }));
    log('Provider: ' + provider.type + ' — ' + health.message);
    statuses.push({
      type: provider.type as ProviderType,
      available: health.available,
      quotaExhausted: false,
      lastChecked: new Date().toISOString(),
      lastError: health.message,
    });
  }
  return statuses;
}

function emptySummary(skipped: string[]): HeadlessSummary {
  return { ok: false, total: 0, completed: 0, failed: 0, cancelled: 0, skipped, tasks: [] };
}

function formatLog(level: string, message: string, jobId?: string): string {
  return '[' + level + '] ' + (jobId ? '[' + jobId + '] ' : '') + message;
}
