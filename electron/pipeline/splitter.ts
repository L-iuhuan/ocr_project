import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { basename, join, extname, dirname } from 'path';
import { randomUUID } from 'crypto';
import { FileInfo, Chunk, ProviderType, PROVIDER_LIMITS } from '../types';
import { getTempDir } from '../state-manager';
import { resolveChunksDir } from './task-workspace';

export interface SplitResult {
  chunks: Chunk[];
  totalChunks: number;
}

export async function splitFileByProvider(
  file: FileInfo,
  provider: ProviderType,
  maxPagesOverride?: number,
  jobId?: string,
  outputDir?: string,
): Promise<SplitResult> {
  const limits = PROVIDER_LIMITS[provider];
  const maxPages = Math.max(1, maxPagesOverride || limits.maxPages);
  const chunks: Chunk[] = [];

  if (file.type === 'image') {
    chunks.push(createChunk(file.path, 0, 1, 1));
    return { chunks, totalChunks: 1 };
  }

  if (file.pageCount <= maxPages) {
    chunks.push(createChunk(file.path, 0, 1, Math.max(1, file.pageCount)));
    return { chunks, totalChunks: 1 };
  }

  if (file.type === 'pdf') {
    return splitPDF(file, maxPages, jobId, outputDir);
  }

  chunks.push(createChunk(file.path, 0, 1, Math.max(1, file.pageCount)));
  return { chunks, totalChunks: 1 };
}

const SPLIT_SIZE_LIMIT = 200 * 1024 * 1024;

async function splitPDF(file: FileInfo, maxPagesPerChunk: number, jobId?: string, outputDir?: string): Promise<SplitResult> {
  const SPLIT_SIZE_LIMIT = 200 * 1024 * 1024;
  if (file.sizeBytes > SPLIT_SIZE_LIMIT) {
    console.warn(`[Splitter] File too large for local split (${(file.sizeBytes/1024/1024).toFixed(0)}MB), treating as single chunk`);
    return {
      chunks: [createChunk(file.path, 0, 1, Math.max(1, file.pageCount))],
      totalChunks: 1,
    };
  }
  const buffer = readFileSync(file.path);
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const totalChunks = Math.ceil(totalPages / maxPagesPerChunk);
  const chunks: Chunk[] = [];
  const jobUUID = randomUUID();
  const outDir = (jobId && outputDir) ? resolveChunksDir(jobId, outputDir) : getTempDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  for (let seq = 0; seq < totalChunks; seq++) {
    const start = seq * maxPagesPerChunk;
    const end = Math.min(start + maxPagesPerChunk, totalPages);

    const chunkDoc = await PDFDocument.create();
    const indices = srcDoc.getPageIndices().slice(start, end);
    const pages = await chunkDoc.copyPages(srcDoc, indices);
    for (const page of pages) chunkDoc.addPage(page);

    // Encode page range in filename for recoverability
    // Format: {name}_p{start}-{end}_{uuid8}.pdf
    const pageStart = start + 1;
    const pageEnd = end;
    const chunkName = `${basename(file.path, extname(file.path))}_p${pageStart}-${pageEnd}_${jobUUID.slice(0, 8)}.pdf`;
    const chunkPath = join(outDir, chunkName);
    writeFileSync(chunkPath, await chunkDoc.save());

    chunks.push({
      chunkSequence: seq,
      chunkPath,
      pageStart,
      pageEnd,
      chunkState: 'pending',
      progress: 0,
      retryCount: 0
    });
  }

  return { chunks, totalChunks };
}

function createChunk(path: string, sequence: number, pageStart: number, pageEnd: number): Chunk {
  return {
    chunkSequence: sequence,
    chunkPath: path,
    pageStart,
    pageEnd,
    chunkState: 'pending',
    progress: 0,
    retryCount: 0
  };
}
