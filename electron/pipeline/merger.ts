import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'fs';
import { basename, dirname, extname, join, relative } from 'path';
import { Chunk, Task, OutputFormat } from '../types';
import { getTempDir } from '../state-manager';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, ImageRun,
  WidthType, ShadingType, convertInchesToTwip,
} from 'docx';

// Windows reserved filenames that cannot be used regardless of extension
const WIN_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Collect markdown content from all done chunks and merge into final output.
 * Multi-chunk: separated by "---"
 * Single chunk: direct copy
 */
export function mergeChunks(
  task: Task,
  doneChunks: Chunk[]
): string {
  const parts: string[] = [];

  for (const chunk of doneChunks.sort((a, b) => a.chunkSequence - b.chunkSequence)) {
    let content = '';
    if (chunk.resultUrl && existsSync(chunk.resultUrl)) {
      content = readFileSync(chunk.resultUrl, 'utf-8').trim();
    }
    const label = chunkLabel(task, chunk);
    if (content) {
      parts.push(`<!-- ${label} -->\n\n${content}`);
    } else {
      parts.push(`<!-- ${label}: no output -->`);
    }
  }

  if (parts.length === 1) {
    // Strip comment wrapper for single chunk — use precise match
    // to avoid stripping content that contains "-->"
    const single = parts[0];
    const match = single.match(/^<!-- .+? -->\n\n/);
    if (match) {
      return single.slice(match[0].length).trim();
    }
    return single;
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Collect images from all done chunk directories.
 * Returns a map of original temp path → new output-relative path.
 *
 * The key insight: markdown image references (e.g. `![](images/img.png)`)
 * are relative to the .md file's own directory, NOT the chunkDir root.
 * When MinerU ZIPs nest content inside a task_id/ subfolder, we must
 * compute relative paths from dirname(resultUrl), not chunkDir.
 */
export function collectImages(
  task: Task,
  doneChunks: Chunk[],
  imageOutputDir: string
): Map<string, string> {
  const mappings = new Map<string, string>();
  if (!doneChunks.length) return mappings;

  ensureDir(imageOutputDir);

  for (const chunk of doneChunks) {
    if (!chunk.resultUrl) continue;

    // The .md file's directory is the anchor for relative image paths
    const mdDir = dirname(chunk.resultUrl);

    // Also scan chunkDir for images that may live outside mdDir
    const chunkDir = join(task.outputDir, '_ocrflow_tmp', task.jobId, 'chunk_' + (chunk.chunkSequence + 1));

    // Collect images from both mdDir and chunkDir (union)
    const imageFiles = new Set<string>();
    if (existsSync(mdDir)) {
      for (const f of findImageFiles(mdDir)) imageFiles.add(f);
    }
    if (mdDir !== chunkDir && existsSync(chunkDir)) {
      for (const f of findImageFiles(chunkDir)) imageFiles.add(f);
    }

    for (const imgPath of imageFiles) {
      const imgName = basename(imgPath);
      // Make unique if collision across chunks
      const uniqueName = `${chunk.chunkSequence}_${imgName}`;
      const destPath = join(imageOutputDir, uniqueName);

      try {
        copyFileSync(imgPath, destPath);
        mappings.set(imgPath, destPath);

        // Compute path relative to the markdown file's directory.
        // This is the path form that appears in the markdown.
        const mdRel = relative(mdDir, imgPath);
        if (mdRel && mdRel !== imgPath) {
          const normalizedMdRel = mdRel.replace(/\\/g, '/');
          mappings.set(normalizedMdRel, destPath);
          // Also map with ./ prefix (common in some markdown generators)
          if (!normalizedMdRel.startsWith('./') && !normalizedMdRel.startsWith('../')) {
            mappings.set('./' + normalizedMdRel, destPath);
          }
        }

        // Also map relative to chunkDir as fallback
        if (mdDir !== chunkDir) {
          const chunkRel = relative(chunkDir, imgPath);
          if (chunkRel && chunkRel !== imgPath && chunkRel !== mdRel) {
            mappings.set(chunkRel.replace(/\\/g, '/'), destPath);
          }
        }
      } catch (e) {
        console.error(`[ImageCollect] Failed to copy ${imgPath}:`, e);
      }
    }
  }

  return mappings;
}

/**
 * Rewrite image paths in markdown from temp dir paths to output dir paths.
 * Also extracts base64 data URIs embedded in the markdown into separate
 * image files and rewrites those references.
 */
export function rewriteImagePaths(
  markdown: string,
  imageMappings: Map<string, string>,
  imageOutputDir?: string
): string {
  let result = markdown;
  const mappings = imageMappings; // may be mutated if we extract base64 images

  // ---- Step 1: extract base64 data URIs as files (if imageOutputDir provided) ----
  if (imageOutputDir) {
    result = extractBase64Images(result, imageOutputDir, mappings);
  }

  if (mappings.size === 0) return result;

  // ---- Step 2: match markdown image syntax ![alt](path) ----
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, path) => {
    // Skip data: URIs (already rewritten by extractBase64Images)
    if (path.startsWith('data:')) return match;
    const rewritten = lookupImagePath(path, mappings);
    return rewritten ? `![${alt}](${rewritten})` : match;
  });

  // ---- Step 3: match HTML img tags ----
  result = result.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, path) => {
    if (path.startsWith('data:')) return match;
    const rewritten = lookupImagePath(path, mappings);
    return rewritten ? match.replace(path, rewritten) : match;
  });

  return result;
}

/**
 * Look up a source path in the image mappings and return the rewritten path.
 * Tries multiple matching strategies: exact match, endsWith, basename match.
 */
function lookupImagePath(
  srcPath: string,
  mappings: Map<string, string>
): string | null {
  const normalizedPath = srcPath.replace(/\\/g, '/');

  // Strategy 1: direct match
  if (mappings.has(normalizedPath)) {
    const destName = basename(mappings.get(normalizedPath)!);
    return `images/${destName}`;
  }

  // Strategy 2: match against all mapping keys
  for (const [origPath, destPath] of mappings) {
    const normalizedOrig = origPath.replace(/\\/g, '/');

    // Exact match
    if (normalizedPath === normalizedOrig) {
      return `images/${basename(destPath)}`;
    }

    // endsWith: handles cases where markdown has "images/img.png"
    // and mapping key is "task_id/images/img.png"
    if (normalizedPath.endsWith('/' + normalizedOrig) || normalizedOrig.endsWith('/' + normalizedPath)) {
      return `images/${basename(destPath)}`;
    }

    // Basename match (last resort): if markdown has just "img.png"
    // and mapping key ends with "/img.png"
    const srcBase = basename(normalizedPath);
    const origBase = basename(normalizedOrig);
    if (srcBase === origBase && srcBase.length > 3) {
      return `images/${basename(destPath)}`;
    }
  }

  return null;
}

/**
 * Extract base64-encoded images from markdown content into actual files.
 * Scans for ![alt](data:image/...;base64,...) and <img src="data:image/...">
 * patterns, decodes the base64 data, writes it to imageOutputDir, and
 * replaces the reference with a file path.
 * Returns the updated markdown.
 */
function extractBase64Images(
  markdown: string,
  imageOutputDir: string,
  mappings: Map<string, string> // mutated: new entries added
): string {
  let result = markdown;
  let counter = 0;

  // Match base64 data URIs in markdown image syntax
  result = result.replace(
    /!\[([^\]]*)\]\((data:image\/(png|jpeg|jpg|gif|bmp|webp);base64,([^)]+))\)/gi,
    (match, alt, _dataUri, ext, b64Data) => {
      counter++;
      const imgName = `extracted_${counter}.${ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase()}`;
      const destPath = join(imageOutputDir, imgName);
      try {
        ensureDir(imageOutputDir);
        writeFileSync(destPath, Buffer.from(b64Data, 'base64'));
        // Add to mappings so it's tracked (though already at final path)
        mappings.set(destPath, destPath);
        return `![${alt}](images/${imgName})`;
      } catch (e) {
        console.error(`[Base64Extract] Failed to write ${imgName}:`, e);
        return match; // keep original if write fails
      }
    }
  );

  // Match base64 data URIs in HTML img tags
  result = result.replace(
    /<img\s+([^>]*?)src=["'](data:image\/(png|jpeg|jpg|gif|bmp|webp);base64,([^"']+))["']([^>]*)>/gi,
    (match, before, _dataUri, ext, b64Data, after) => {
      counter++;
      const imgName = `extracted_${counter}.${ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase()}`;
      const destPath = join(imageOutputDir, imgName);
      try {
        ensureDir(imageOutputDir);
        writeFileSync(destPath, Buffer.from(b64Data, 'base64'));
        mappings.set(destPath, destPath);
        return `<img ${before}src="images/${imgName}"${after}>`;
      } catch (e) {
        console.error(`[Base64Extract] Failed to write ${imgName}:`, e);
        return match;
      }
    }
  );

  return result;
}

/**
 * Write final outputs to task.outputDir.
 * Supports md, json, html, docx formats.
 * Returns list of written file paths.
 */
export async function writeMergedOutputs(
  task: Task,
  mergedMarkdown: string,
  partial: boolean,
  fileNameTemplate?: string,
  imageOutputDir?: string,
): Promise<string[]> {
  ensureDir(task.outputDir);

  // Apply file name template: supports {name}, {date}, {time}, {timestamp}
  const rawName = basename(task.originalName, extname(task.originalName));
  let baseName: string;
  if (fileNameTemplate) {
    const now = new Date();
    const Y = now.getFullYear().toString();
    const M = (now.getMonth() + 1).toString().padStart(2, '0');
    const D = now.getDate().toString().padStart(2, '0');
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    baseName = sanitizeFileName(
      fileNameTemplate
        .replace(/\{name\}/g, rawName)
        .replace(/\{date\}/g, `${Y}-${M}-${D}`)
        .replace(/\{time\}/g, `${h}-${m}-${s}`)
        .replace(/\{timestamp\}/g, `${Y}${M}${D}${h}${m}${s}`)
    );
    // If template resulted in empty or unchanged from literal, fall back
    if (!baseName || baseName === fileNameTemplate) {
      baseName = sanitizeFileName(rawName);
    }
  } else {
    baseName = sanitizeFileName(rawName);
  }
  if (partial) baseName += '_partial';
  const formats: OutputFormat[] =
    task.outputFormats.length > 0 ? task.outputFormats : ['md'];
  const written: string[] = [];

  // Ensure subdirectory exists when template includes path separators
  if (baseName.includes('/')) {
    ensureDir(join(task.outputDir, dirname(baseName)));
  }

  if (formats.includes('md')) {
    const path = uniquePath(task.outputDir, `${baseName}.md`);
    writeFileSync(path, mergedMarkdown, 'utf-8');
    console.log('[输出] Markdown: ' + basename(path) + ' (' + (mergedMarkdown.length / 1024).toFixed(1) + ' KB)');
    written.push(path);
  }

  if (formats.includes('json')) {
    const path = uniquePath(task.outputDir, `${baseName}.json`);
    const jsonContent = JSON.stringify(
      {
        originalName: task.originalName,
        providerUsed: task.providerUsed,
        partial,
        pageCount: task.pageCount,
        chunks: task.chunks.map(c => ({
          sequence: c.chunkSequence,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          state: c.chunkState,
          errorCode: c.errorCode,
          errorMsg: c.errorMsg,
        })),
        markdown: mergedMarkdown,
      },
      null,
      2
    );
    writeFileSync(path, jsonContent, 'utf-8');
    console.log('[输出] JSON: ' + basename(path) + ' (' + (jsonContent.length / 1024).toFixed(1) + ' KB)');
    written.push(path);
  }

  if (formats.includes('html')) {
    const path = uniquePath(task.outputDir, `${baseName}.html`);
    const htmlContent = renderHtml(task.originalName, mergedMarkdown);
    writeFileSync(path, htmlContent, 'utf-8');
    console.log('[输出] HTML: ' + basename(path) + ' (' + (htmlContent.length / 1024).toFixed(1) + ' KB)');
    written.push(path);
  }

  if (formats.includes('docx')) {
    const path = uniquePath(task.outputDir, `${baseName}.docx`);
    await writeDocx(path, task.originalName, mergedMarkdown, imageOutputDir || join(task.outputDir, 'images'));
    written.push(path);
  }

  return written;
}

/**
 * Clean up temporary chunk files and extraction directories.
 */
export function cleanupTempFiles(task: Task): void {
  const tempDir = getTempDir();
  for (const chunk of task.chunks) {
    if (!chunk.chunkPath || !existsSync(chunk.chunkPath)) continue;
    const rel = relative(tempDir, chunk.chunkPath);
    if (!rel.startsWith('..') && !rel.includes(':')) {
      try { rmSync(chunk.chunkPath, { force: true }); } catch {}
    }
  }

  // Delete the job-specific temp directory inside outputDir
  const tmpOutput = join(task.outputDir, '_ocrflow_tmp', task.jobId);
  try { rmSync(tmpOutput, { recursive: true, force: true }); } catch {}

  // Try to remove the _ocrflow_tmp parent if empty. Also handle stale
  // hidden files (.DS_Store, Thumbs.db, desktop.ini) that might prevent
  // the directory from appearing empty.
  const tmpParent = join(task.outputDir, '_ocrflow_tmp');
  try {
    if (existsSync(tmpParent)) {
      const remaining = readdirSync(tmpParent).filter(
        e => e !== '.' && e !== '..' && !e.startsWith('.') && e !== 'desktop.ini' && e !== 'Thumbs.db'
      );
      if (remaining.length === 0) {
        // Remove hidden junk files first, then the directory
        for (const entry of readdirSync(tmpParent)) {
          try { rmSync(join(tmpParent, entry), { recursive: true, force: true }); } catch {}
        }
        rmSync(tmpParent, { force: true });
      }
    }
  } catch {}
}

// ---- Helpers ----

function chunkLabel(task: Task, chunk: Chunk): string {
  if (chunk.pageStart && chunk.pageEnd) {
    return `pages ${chunk.pageStart}-${chunk.pageEnd}`;
  }
  return `${task.originalName} #${chunk.chunkSequence + 1}`;
}

/**
 * Sanitize filename: remove illegal characters and handle Windows reserved names
 * (CON, PRN, AUX, NUL, COM1-9, LPT1-9) which cannot be used as file names regardless of extension.
 */
function sanitizeFileName(name: string): string {
  // Preserve `/` for subdirectory templates like {date}/{name}.
  // Only strip truly illegal filename characters (not path separators).
  let s = name.replace(/[<>:"|?*\x00-\x1F]/g, '_').replace(/\\/g, '/').trim() || 'document';

  // Ensure each path segment is sanitized and doesn't start/end with space or dot
  const segments = s.split('/').map(seg => {
    let part = seg.trim().replace(/^\.+/, '').replace(/\.+$/, '') || 'document';
    if (WIN_RESERVED_NAMES.test(part.split('.')[0] || '')) {
      part = '_' + part;
    }
    return part;
  });

  return segments.join('/');
}

function uniquePath(dir: string, fileName: string): string {
  const ext = extname(fileName);
  const name = basename(fileName, ext);
  let candidate = join(dir, fileName);
  let index = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${name}_${index}${ext}`);
    index++;
  }
  return candidate;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Recursively find image files in a directory, with depth limit to prevent stack overflow */
function findImageFiles(dir: string, maxDepth: number = 10): string[] {
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg']);
  const results: string[] = [];

  function scan(current: string, depth: number) {
    if (depth > maxDepth || !existsSync(current)) return;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          // Skip only . and .. and node_modules
          if (entry !== '.' && entry !== '..' && entry !== 'node_modules') {
            scan(full, depth + 1);
          }
        } else if (imageExts.has(extname(entry).toLowerCase())) {
          results.push(full);
        }
      } catch {}
    }
  }

  scan(dir, 1);
  return results;
}

function renderHtml(title: string, markdown: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; margin: 40px auto; max-width: 920px; padding: 0 24px; color: #111827; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <pre>${escapeHtml(markdown)}</pre>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch)
  );
}

// ---- DOCX generation using the `docx` library ----

/**
 * Parse markdown into structured blocks, then build a proper .docx with:
 * - Heading styles (H1-H3)
 * - Tables with borders (| col | col | format)
 * - Embedded images (![alt](path))
 * - Inline bold / italic
 * - Bullet lists (- or * items)
 * - Code blocks (``` ```) in monospace
 * - Horizontal rules (---)
 */
async function writeDocx(
  path: string,
  title: string,
  markdown: string,
  imageDir: string,
): Promise<void> {
  console.log('[DOCX] 开始转换: ' + basename(path) + ' (' + (markdown.length / 1024).toFixed(1) + ' KB markdown)');
  const blocks = parseMarkdownBlocks(markdown);
  console.log('[DOCX] 解析完成: ' + blocks.length + ' 个块 (' +
    blocks.filter(b => b.kind === 'table').length + ' 表格, ' +
    blocks.filter(b => b.kind === 'image').length + ' 图片)');

  const children = await buildDocxChildren(blocks, title, imageDir);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 }, // 11pt
        },
      },
    },
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(path, buffer);
  console.log('[DOCX] 转换完成: ' + basename(path) + ' (' + (buffer.length / 1024).toFixed(1) + ' KB)');
}

// ---- Markdown block parser ----

type MdBlock =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'hr' }
  | { kind: 'list'; items: string[] };

function parseMarkdownBlocks(md: string): MdBlock[] {
  const lines = md.split(/\r?\n/);
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) { i++; continue; }

    // Headers
    const h1 = line.match(/^# (.+)/);
    if (h1 && !line.startsWith('##')) { blocks.push({ kind: 'h1', text: stripFormatMarkers(h1[1]) }); i++; continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2 && !line.startsWith('###')) { blocks.push({ kind: 'h2', text: stripFormatMarkers(h2[1]) }); i++; continue; }
    const h3 = line.match(/^### (.+)/);
    if (h3) { blocks.push({ kind: 'h3', text: stripFormatMarkers(h3[1]) }); i++; continue; }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ kind: 'hr' }); i++; continue; }

    // Image ![alt](path)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) { blocks.push({ kind: 'image', alt: imgMatch[1], src: imgMatch[2] }); i++; continue; }

    // Code block ```
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]); i++;
      }
      i++; // skip closing ```
      blocks.push({ kind: 'code', lines: codeLines });
      continue;
    }

    // HTML table <table> ... </table> (common in MinerU/PaddleOCR output)
    if (/<table\b/i.test(line)) {
      const htmlLines: string[] = [line];
      i++;
      while (i < lines.length && !/<\/table>/i.test(lines[i])) {
        htmlLines.push(lines[i]); i++;
      }
      if (i < lines.length) { htmlLines.push(lines[i]); i++; } // closing </table>
      const parsed = parseHtmlTable(htmlLines.join('\n'));
      if (parsed) {
        blocks.push({ kind: 'table', headers: parsed.headers, rows: parsed.rows });
      }
      continue;
    }

    // Markdown pipe table | ... | ... |
    if (/^\|.+\|/.test(line)) {
      const tableRows: string[][] = [];
      // header row
      tableRows.push(line.split('|').slice(1, -1).map(c => c.trim()));
      i++;
      // separator row (skip)
      if (i < lines.length && /^\|[\s\-:]+\|/.test(lines[i])) i++;
      // data rows
      while (i < lines.length && /^\|.+\|/.test(lines[i])) {
        tableRows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()));
        i++;
      }
      if (tableRows.length > 1) {
        blocks.push({ kind: 'table', headers: tableRows[0], rows: tableRows.slice(1) });
      } else {
        // Single table-like line — treat as paragraph
        blocks.push({ kind: 'para', text: stripFormatMarkers(line) });
      }
      continue;
    }

    // List items
    if (/^[\-\*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i])) {
        items.push(stripFormatMarkers(lines[i].replace(/^[\-\*]\s+/, '')));
        i++;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    // Regular paragraph
    blocks.push({ kind: 'para', text: stripFormatMarkers(line) });
    i++;
  }

  return blocks;
}

/** Strip markdown formatting markers but keep the text (for heading/paragraph content) */
function stripFormatMarkers(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .trim();
}

/** Parse an HTML <table> string into headers and rows */
function parseHtmlTable(html: string): { headers: string[]; rows: string[][] } | null {
  // Extract rows
  const trMatch = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!trMatch || trMatch.length < 2) return null;

  const allRows: string[][] = [];
  for (const tr of trMatch) {
    const cells: string[] = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRe.exec(tr)) !== null) {
      // Strip inner HTML tags and decode common entities
      let text = tdM[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();
      cells.push(text);
    }
    if (cells.length > 0) allRows.push(cells);
  }

  if (allRows.length < 2) return null;

  return { headers: allRows[0], rows: allRows.slice(1) };
}

// ---- Build DOCX children from blocks ----

async function buildDocxChildren(
  blocks: MdBlock[],
  title: string,
  imageDir: string,
): Promise<(Paragraph | Table)[]> {
  const children: (Paragraph | Table)[] = [];

  // Title paragraph
  children.push(new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
  }));

  for (const block of blocks) {
    switch (block.kind) {
      case 'h1':
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
          children: parseInline(block.text),
        }));
        break;
      case 'h2':
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
          children: parseInline(block.text),
        }));
        break;
      case 'h3':
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
          children: parseInline(block.text),
        }));
        break;
      case 'para':
        if (block.text) {
          children.push(new Paragraph({
            spacing: { after: 80 },
            children: parseInline(block.text),
          }));
        }
        break;
      case 'code':
        for (const codeLine of block.lines) {
          children.push(new Paragraph({
            spacing: { after: 0, line: 240 },
            shading: { type: ShadingType.SOLID, color: 'F0F0F0', fill: 'F0F0F0' },
            children: [new TextRun({ text: codeLine || ' ', font: 'Consolas', size: 18 })],
          }));
        }
        break;
      case 'image':
        children.push(await buildImageParagraph(block.src, block.alt, imageDir));
        break;
      case 'hr':
        children.push(new Paragraph({
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC', space: 1 } },
          children: [],
        }));
        break;
      case 'list':
        for (const item of block.items) {
          children.push(new Paragraph({
            spacing: { after: 40 },
            bullet: { level: 0 },
            children: parseInline(item),
          }));
        }
        break;
      case 'table':
        children.push(buildTable(block.headers, block.rows));
        break;
    }
  }

  return children;
}

// ---- Inline formatting parser ----

function parseInline(text: string): TextRun[] {
  if (!text) return [];

  // Strip HTML tags but keep <br> as line breaks
  const cleaned = text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
  if (!cleaned) return [];

  const runs: TextRun[] = [];
  const segments = cleaned.split('\n');
  for (let si = 0; si < segments.length; si++) {
    if (si > 0) runs.push(new TextRun({ break: 1 }));
    parseInlineSegment(segments[si], runs);
  }

  return runs;
}

function parseInlineSegment(text: string, runs: TextRun[]): void {
  if (!text) return;
  const re = /(\*\*(.+?)\*\*)|(__([^_]+)__)|(\*(.+?)\*)|(_([^_]+)_)|(`([^`]+)`)|([^*_`]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      runs.push(new TextRun({ text: m[2], bold: true }));
    } else if (m[3]) {
      runs.push(new TextRun({ text: m[4], bold: true }));
    } else if (m[5]) {
      runs.push(new TextRun({ text: m[6], italics: true }));
    } else if (m[7]) {
      runs.push(new TextRun({ text: m[8], italics: true }));
    } else if (m[9]) {
      runs.push(new TextRun({ text: m[10], font: 'Consolas', size: 18 }));
    } else if (m[11]) {
      runs.push(new TextRun({ text: m[11] }));
    }
  }

  // Fallback: if no runs were added, use plain text
  if (runs.length === 0) runs.push(new TextRun({ text }));
}

// ---- Table builder ----

function buildTable(headers: string[], rows: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
  const cellBorders = { top: border, bottom: border, left: border, right: border };

  const headerCells = headers.map(h =>
    new TableCell({
      children: [new Paragraph({
        children: parseInline(h),
        alignment: AlignmentType.CENTER,
      })],
      shading: { type: ShadingType.SOLID, color: 'E8E8E8', fill: 'E8E8E8' },
      borders: cellBorders,
      width: { size: Math.max(1500, Math.floor(9000 / Math.max(1, headers.length))), type: WidthType.DXA },
    })
  );

  const dataRows = rows.map(row =>
    new TableRow({
      children: row.map(cell =>
        new TableCell({
          children: [new Paragraph({ children: parseInline(cell) })],
          borders: cellBorders,
        })
      ),
    })
  );

  return new Table({
    rows: [
      new TableRow({ children: headerCells, tableHeader: true }),
      ...dataRows,
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ---- Image paragraph ----

async function buildImageParagraph(
  src: string,
  alt: string,
  imageDir: string,
): Promise<Paragraph> {
  // Resolve image path: try absolute, then relative to imageDir
  let imgPath: string;
  if (existsSync(src)) {
    imgPath = src;
  } else {
    const candidate = join(imageDir, basename(src));
    if (existsSync(candidate)) {
      imgPath = candidate;
    } else {
      // Image not found — show placeholder text
      return new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: `[图片: ${alt || basename(src)}]`, italics: true, color: '999999' })],
      });
    }
  }

  try {
    const imgBuffer = readFileSync(imgPath);
    // Determine image type from extension
    const ext = extname(imgPath).toLowerCase();
    const typeMap: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
      '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.gif': 'gif', '.bmp': 'bmp',
      '.webp': 'png', '.tif': 'png', '.tiff': 'png', '.svg': 'png',
    };
    const imgType = typeMap[ext] || 'png';

    // Constrain image size: max 5.5in wide, max 4in tall
    const maxW = convertInchesToTwip(5.5);
    const maxH = convertInchesToTwip(4);

    return new Paragraph({
      spacing: { before: 120, after: 120 },
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: imgBuffer,
          transformation: { width: maxW, height: maxH },
          type: imgType,
          altText: { title: alt, description: alt, name: basename(imgPath) },
        }),
      ],
    });
  } catch {
    return new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: `[图片读取失败: ${alt || basename(src)}]`, italics: true, color: 'CC0000' })],
    });
  }
}
