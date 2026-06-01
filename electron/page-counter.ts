import { ProviderType, ProviderQuotaInfo, PageCountRecord, PROVIDER_LIMITS } from './types';
import { loadPageCounts, savePageCounts } from './state-manager';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getProviderQuotas(): ProviderQuotaInfo[] {
  const counts = loadPageCounts();
  const date = today();
  const todayCounts = counts[date] || {};

  const providers: ProviderType[] = ['mineru-cloud', 'paddleocr-cloud', 'paddleocr-local'];

  return providers.map(p => {
    const record = todayCounts[p] || { pagesProcessed: 0, pagesFailed: 0 };
    const limit = PROVIDER_LIMITS[p].dailyQuotaPages;

    return {
      provider: p,
      dailyLimit: limit,
      usedToday: record.pagesProcessed || 0,
      failedToday: record.pagesFailed || 0,
      remaining: limit === -1 ? -1 : Math.max(0, limit - (record.pagesProcessed || 0)),
      percentUsed: limit === -1 ? 0 : Math.min(100, ((record.pagesProcessed || 0) / limit) * 100)
    };
  });
}

export function incrementPageCount(provider: ProviderType, pages: number): void {
  const counts = loadPageCounts();
  const date = today();

  if (!counts[date]) counts[date] = {};
  if (!counts[date][provider]) {
    counts[date][provider] = { date, provider, pagesProcessed: 0, pagesFailed: 0 };
  }

  counts[date][provider].pagesProcessed += pages;
  savePageCounts(counts);
}

export function incrementFailedCount(provider: ProviderType, pages: number): void {
  const counts = loadPageCounts();
  const date = today();

  if (!counts[date]) counts[date] = {};
  if (!counts[date][provider]) {
    counts[date][provider] = { date, provider, pagesProcessed: 0, pagesFailed: 0 };
  }

  counts[date][provider].pagesFailed += pages;
  savePageCounts(counts);
}

export function getTotalProcessedToday(provider: ProviderType): number {
  const info = getProviderQuotas().find(q => q.provider === provider);
  return info ? info.usedToday : 0;
}

export function isQuotaExhausted(provider: ProviderType): boolean {
  const info = getProviderQuotas().find(q => q.provider === provider);
  if (!info || info.dailyLimit === -1) return false;
  return info.remaining <= 0;
}
