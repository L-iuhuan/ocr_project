import { ProviderType } from './types';

export interface HeadlessParseOptions {
  paths: string[];
  outputDir?: string;
  providers?: ProviderType[];
  concurrency?: number;
  chunkSize?: number;
  json: boolean;
}

export type HeadlessArgsResult =
  | { mode: 'none' }
  | { mode: 'help'; text: string }
  | { mode: 'error'; message: string; text: string }
  | { mode: 'parse'; options: HeadlessParseOptions };

const VALID_PROVIDERS: ProviderType[] = ['mineru-cloud', 'paddleocr-cloud', 'paddleocr-local'];

export function parseHeadlessArgs(argv: string[]): HeadlessArgsResult {
  const headlessIndex = argv.indexOf('--headless');
  if (headlessIndex === -1) return { mode: 'none' };

  const args = argv.slice(headlessIndex + 1);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { mode: 'help', text: usage() };
  }

  const command = args.shift();
  if (command !== 'parse') {
    return { mode: 'error', message: 'Unsupported headless command: ' + (command || ''), text: usage() };
  }

  const paths: string[] = [];
  const options: HeadlessParseOptions = { paths, json: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') {
      const value = args[++i];
      if (!value) return { mode: 'error', message: '--out requires a directory', text: usage() };
      options.outputDir = value;
      continue;
    }
    if (arg === '--provider') {
      const value = args[++i];
      if (!value) return { mode: 'error', message: '--provider requires a value', text: usage() };
      if (value === 'auto') {
        options.providers = undefined;
      } else {
        const provider = parseProvider(value);
        if (!provider) return { mode: 'error', message: 'Invalid provider: ' + value, text: usage() };
        options.providers = [provider];
      }
      continue;
    }
    if (arg === '--providers') {
      const value = args[++i];
      if (!value) return { mode: 'error', message: '--providers requires a comma-separated list', text: usage() };
      const providers = value.split(',').map(p => parseProvider(p.trim()));
      if (providers.some(p => !p)) return { mode: 'error', message: 'Invalid providers: ' + value, text: usage() };
      options.providers = providers as ProviderType[];
      continue;
    }
    if (arg === '--concurrency') {
      const value = parsePositiveInt(args[++i]);
      if (!value) return { mode: 'error', message: '--concurrency requires a positive integer', text: usage() };
      options.concurrency = value;
      continue;
    }
    if (arg === '--chunk-size') {
      const value = parsePositiveInt(args[++i]);
      if (!value) return { mode: 'error', message: '--chunk-size requires a positive integer', text: usage() };
      options.chunkSize = value;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      return { mode: 'error', message: 'Unknown option: ' + arg, text: usage() };
    }
    paths.push(arg);
  }

  if (paths.length === 0) {
    return { mode: 'error', message: 'No input paths provided', text: usage() };
  }

  return { mode: 'parse', options };
}

export function usage(): string {
  return [
    'Usage:',
    '  OCRFlow --headless parse <files-or-folders...> [options]',
    '',
    'Options:',
    '  --out <dir>                         Override output directory',
    '  --provider <auto|mineru-cloud|paddleocr-cloud|paddleocr-local>',
    '  --providers <comma-separated-list>   Override provider fallback order',
    '  --concurrency <n>                    Override concurrency (1-8)',
    '  --chunk-size <n>                     Override pages per chunk',
    '  --json                               Print final summary as JSON',
    '  --help                               Show this help',
  ].join('\n');
}

function parseProvider(value: string): ProviderType | null {
  return VALID_PROVIDERS.includes(value as ProviderType) ? value as ProviderType : null;
}

function parsePositiveInt(value?: string): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
