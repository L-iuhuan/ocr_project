import { PDFDocument } from 'pdf-lib';
import { readFileSync, openSync, readSync, closeSync, existsSync } from 'fs';
import { FileInfo } from '../types';

/**
 * Analyze a single file to determine its type and page count.
 * For PDFs: tries pdf-lib first, then falls back to trailer regex,
 * then size estimation. Never returns pageCount 0 for a valid file.
 * For non-PDF files, estimates page count from file size.
 */
export async function analyzeFile(info: FileInfo): Promise<FileInfo> {
  switch (info.type) {
    case 'pdf':
      return analyzePDF(info);
    case 'image':
      return { ...info, pageCount: 1 };
    case 'pptx':
    case 'ppt':
    case 'docx':
    case 'doc':
    case 'xlsx':
    case 'txt':
    case 'wps':
    case 'ofd':
      return { ...info, pageCount: estimatePagesBySize(info.sizeBytes, info.type) };
    default:
      return { ...info, pageCount: 1 };
  }
}

/** Estimate pages for office documents — tuned per format */
function estimatePagesBySize(bytes: number, fileType: string): number {
  // Office docs average differently from each other
  const bytesPerPage: Record<string, number> = {
    pptx: 80000,  // slides tend to be heavy (images)
    ppt:  80000,
    docx: 30000,  // text-heavy but with formatting overhead
    doc:  25000,
    xlsx: 15000,  // spreadsheets compress well
    txt:  3000,   // plain text ~3KB per page
    wps:  30000,
    ofd:  40000,
  };
  const bpp = bytesPerPage[fileType] || 51200;
  return Math.max(1, Math.ceil(bytes / bpp));
}

/**
 * Analyze a PDF file with multi-tier fallback.
 *
 * Tier 1: pdf-lib (accurate, requires loading full file into memory).
 * Tier 2: trailer regex — reads only last 4KB of file looking for
 *          /Pages /Count or /N entries (fast, handles most PDFs).
 * Tier 3: size estimation (last resort, never returns 0).
 */
async function analyzePDF(info: FileInfo): Promise<FileInfo> {
  if (!existsSync(info.path)) return { ...info, pageCount: 0 };

  const LARGE_FILE_THRESHOLD = 200 * 1024 * 1024;

  // ---- Tier 1: pdf-lib (full parse, only for files under threshold) ----
  if (info.sizeBytes <= LARGE_FILE_THRESHOLD) {
    try {
      const buffer = readFileSync(info.path);
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const count = doc.getPageCount();
      if (count > 0) return { ...info, pageCount: count };
    } catch (err: any) {
      console.warn(`[Preprocessor] pdf-lib failed for "${info.path}": ${err.message || err}`);
    }
  } else {
    console.log(`[Preprocessor] File too large for pdf-lib parse (${(info.sizeBytes/1024/1024).toFixed(0)}MB), using trailer estimation`);
  }

  // ---- Tier 2: trailer regex (fast, reads only last 4KB) ----
  try {
    const count = countPagesViaTrailer(info.path);
    if (count > 0) {
      console.log(`[Preprocessor] Trailer fallback: "${info.path}" → ${count} pages`);
      return { ...info, pageCount: count };
    }
  } catch (err: any) {
    console.warn(`[Preprocessor] Trailer fallback failed for "${info.path}": ${err.message || err}`);
  }

  // ---- Tier 3: size estimation ----
  if (info.sizeBytes === 0) return { ...info, pageCount: 0 };
  const estimated = Math.max(1, Math.ceil(info.sizeBytes / 150000));
  console.warn(`[Preprocessor] Size fallback: "${info.path}" → ~${estimated} pages (${(info.sizeBytes/1024/1024).toFixed(1)}MB)`);
  return { ...info, pageCount: estimated };
}

/**
 * Count PDF pages by scanning the trailer for /Pages object.
 * Reads only the last 4KB + first page-tree references.
 * Handles linearized PDFs by checking both file start and end.
 */
function countPagesViaTrailer(filePath: string): number {
  const fd = openSync(filePath, 'r');
  try {
    const stat = require('fs').statSync(filePath);
    const size = stat.size;

    // Read last 4KB (standard trailer location)
    const tailSize = Math.min(4096, size);
    const tailBuf = Buffer.alloc(tailSize);
    readSync(fd, tailBuf, 0, tailSize, size - tailSize);
    const tail = tailBuf.toString('latin1');

    // Try /Pages>> <<.../Count N pattern
    const countMatch = tail.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/i)
      || tail.match(/\/Pages\s*<<[^>]*\/Count\s+(\d+)/i)
      || tail.match(/\/Count\s+(\d+)/i);
    if (countMatch) {
      const n = parseInt(countMatch[1], 10);
      if (n > 0 && n < 100000) return n;
    }

    // Try linearized PDF (xref at beginning)
    if (size > 4096) {
      const headBuf = Buffer.alloc(4096);
      readSync(fd, headBuf, 0, 4096, 0);
      const head = headBuf.toString('latin1');
      const headMatch = head.match(/\/N\s+(\d+)\s+\/T/);
      if (headMatch) {
        const n = parseInt(headMatch[1], 10);
        if (n > 0 && n < 100000) return n;
      }
    }

    return 0;
  } finally {
    try { closeSync(fd); } catch {}
  }
}

export async function analyzeFiles(files: FileInfo[]): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  // Process sequentially to limit peak memory
  for (const f of files) {
    results.push(await analyzeFile(f));
  }
  return results;
}
