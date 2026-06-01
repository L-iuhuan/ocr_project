import { PROVIDER_LIMITS, ProviderType, ProviderLimits, FileType } from '../types';
import { IProvider } from './i-provider';

const providers = new Map<ProviderType, IProvider>();

export function registerProvider(provider: IProvider): void {
  providers.set(provider.type, provider);
}

export function getProvider(type: ProviderType): IProvider | undefined {
  return providers.get(type);
}

export function getAvailableProviders(priority: ProviderType[]): IProvider[] {
  return priority.map(t => providers.get(t)).filter((p): p is IProvider => p !== undefined);
}

export function getProviderLimits(type: ProviderType): ProviderLimits {
  return PROVIDER_LIMITS[type];
}

export function canProviderHandle(type: ProviderType, fileType: FileType): boolean {
  const limits = PROVIDER_LIMITS[type];
  return limits.supportsFormats.includes(fileType);
}
