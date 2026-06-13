import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'fs';
import { basename, dirname, extname, join, relative } from 'path';
import { Chunk, Task, OutputFormat } from '../types';
import { getTempDir } from '../state-manager';
import { resolveChunkResultDir } from './task-workspace';
import AdmZip from 'adm-zip';

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

  let firstImageWritten = false;

  for (const chunk of doneChunks) {
    if (!chunk.resultUrl) continue;

    // The .md file's directory is the anchor for relative image paths
    const mdDir = dirname(chunk.resultUrl);

    // Also scan chunkDir for images that may live outside mdDir
    const chunkDir = resolveChunkResultDir(task.jobId, task.outputDir, chunk.chunkSequence);

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
        if (!firstImageWritten) { ensureDir(imageOutputDir); firstImageWritten = true; }
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

  // Remove NUL/control bytes returned by OCR providers. A single \x00 can make
  // editors treat an otherwise valid Markdown file as binary.
  mergedMarkdown = sanitizeTextContent(mergedMarkdown);

  // Adjust image paths for subdirectory output. Images always live at
  // {outputDir}/images/, but the .md/.html may be at {outputDir}/subdir/file.
  // In that case we need ../images/ instead of images/.
  const depth = baseName.includes('/') ? baseName.split('/').length - 1 : 0;
  const imagePrefix = depth > 0 ? '../'.repeat(depth) + 'images/' : 'images/';
  if (depth > 0 && mergedMarkdown.includes('](images/')) {
    mergedMarkdown = mergedMarkdown.replace(/\]\(images\//g, '](' + imagePrefix);
    mergedMarkdown = mergedMarkdown.replace(/src="images\//g, 'src="' + imagePrefix);
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
    try {
      await writeDocx(path, task.originalName, mergedMarkdown, imageOutputDir || join(task.outputDir, 'images'));
      written.push(path);
    } catch (docxErr: any) {
      console.error('[DOCX] 生成失败: ' + (docxErr.message || docxErr));
    }
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
        rmSync(tmpParent, { recursive: true, force: true });
      }
    }
  } catch {}
}

// ---- Helpers ----

function sanitizeTextContent(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

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
  const body = markdownToHtml(markdown);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <script>
    window.MathJax = { tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']] }, svg: { fontCache: 'global' } };
  </script>
  <script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
           line-height: 1.75; margin: 40px auto; max-width: 920px; padding: 0 24px; color: #111827; background: #fff; }
    h1 { font-size: 1.6em; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.1em; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; }
    img { max-width: 100%; height: auto; }
    pre { background: #f5f5f5; padding: 12px 16px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
    code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    hr { border: none; border-top: 1px solid #e5e5e5; margin: 20px 0; }
    blockquote { border-left: 3px solid #ccc; margin: 0; padding: 2px 16px; color: #666; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Simple markdown → HTML converter (handles common OCR output patterns) */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let inTable = false;
  let inList = false;

  while (i < lines.length) {
    let line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      if (inCode) { out.push('</code></pre>'); inCode = false; i++; continue; }
      out.push('<pre><code>');
      inCode = true; i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        out.push(escapeHtml(lines[i])); i++;
      }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); i++; continue; }

    // Empty line
    if (!line.trim()) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inTable) { out.push('</table>'); inTable = false; }
      i++; continue;
    }

    // HTML table
    if (/<table\b/i.test(line)) {
      const htmlLines = [line]; i++;
      while (i < lines.length && !/<\/table>/i.test(lines[i])) { htmlLines.push(lines[i]); i++; }
      if (i < lines.length) { htmlLines.push(lines[i]); i++; }
      out.push(htmlLines.join('\n')
        .replace(/<table[^>]*>/gi, '<table>')
        .replace(/style='[^']*'/gi, '')
        .replace(/style="[^"]*"/gi, '')
      );
      continue;
    }

    // Pipe table
    if (/^\|.+\|/.test(line)) {
      if (!inTable) { out.push('<table>'); inTable = true; }
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const tag = inTable && out[out.length - 1] === '<table>' ? 'th' : 'td';
      out.push('<tr>' + cells.map(c => `<${tag}>${inlineMdToHtml(c)}</${tag}>`).join('') + '</tr>');
      i++;
      if (i < lines.length && /^\|[\s\-:]+\|/.test(lines[i])) i++; // skip separator
      continue;
    }
    if (inTable && !/^\|.+\|/.test(line)) { out.push('</table>'); inTable = false; }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // Image-only line
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) { out.push(`<p><img src="${imgMatch[2]}" alt="${imgMatch[1]}"></p>`); i++; continue; }

    // Header
    const h1 = line.match(/^# (.+)/);
    if (h1 && !line.startsWith('##')) { out.push(`<h1>${inlineMdToHtml(h1[1])}</h1>`); i++; continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2 && !line.startsWith('###')) { out.push(`<h2>${inlineMdToHtml(h2[1])}</h2>`); i++; continue; }
    const h3 = line.match(/^### (.+)/);
    if (h3) { out.push(`<h3>${inlineMdToHtml(h3[1])}</h3>`); i++; continue; }

    // List item
    if (/^[\-\*]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      const text = line.replace(/^[\-\*]\s+/, '');
      out.push(`<li>${inlineMdToHtml(text)}</li>`);
      i++; continue;
    }
    if (inList && !/^[\-\*]\s/.test(line)) { out.push('</ul>'); inList = false; }

    // Regular paragraph
    const imgInline = line.match(/!\[([^\]]*)\]\(([^)]+)\)/g);
    let html = inlineMdToHtml(line);
    if (imgInline) {
      for (const m of imgInline) {
        const parsed = m.match(/!\[([^\]]*)\]\(([^)]+)\)/);
        if (parsed) html = html.replace(m, `<img src="${parsed[2]}" alt="${parsed[1]}">`);
      }
    }
    out.push(`<p>${html}</p>`);
    i++;
  }

  if (inCode) out.push('</code></pre>');
  if (inTable) out.push('</table>');
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function inlineMdToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/_([^_]+)_/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(value: string): string { return escapeXml(value); }

// ---- DOCX generation using adm-zip (direct OOXML) ----

/**
 * Build a proper .docx file from markdown blocks.
 * Uses adm-zip to construct the OOXML package directly — no external docx library.
 * Supports: headings, tables, images, bold/italic, lists, code blocks, HR.
 */
function writeDocx(
  path: string,
  title: string,
  markdown: string,
  imageDir: string,
): void {
  console.log('[DOCX] 开始转换: ' + basename(path) + ' (' + (markdown.length / 1024).toFixed(1) + ' KB markdown)');
  const blocks = parseMarkdownBlocks(markdown);
  console.log('[DOCX] 解析完成: ' + blocks.length + ' 个块 (' +
    blocks.filter(b => b.kind === 'table').length + ' 表格, ' +
    blocks.filter(b => b.kind === 'image').length + ' 图片)');

  const zip = new AdmZip();
  const imageParts: { name: string; buffer: Buffer; rid: string }[] = [];

  // Build document body XML
  let bodyXml = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>`;
  for (const block of blocks) {
    bodyXml += blockToDocxXml(block, imageDir, imageParts);
  }
  bodyXml += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

  // Package-level relationships (only the document reference)
  const pkgRels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

  // Word-level relationships (image references MUST be here for OOXML compliance)
  let docRels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (const img of imageParts) {
    docRels += `<Relationship Id="${img.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.name}"/>`;
  }
  docRels += '</Relationships>';

  // Content types
  let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>';
  for (const img of imageParts) {
    const ext = (img.name.split('.').pop() || 'png').toLowerCase();
    ct += `<Default Extension="${ext}" ContentType="${ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'}"/>`;
  }
  ct += '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '</Types>';

  // Styles (headings + list)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
</w:styles>`;

  // Assemble
  zip.addFile('[Content_Types].xml', Buffer.from(ct, 'utf-8'));
  zip.addFile('_rels/.rels', Buffer.from(pkgRels, 'utf-8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels, 'utf-8'));
  zip.addFile('word/document.xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${bodyXml}</w:body>
</w:document>`, 'utf-8'));
  zip.addFile('word/styles.xml', Buffer.from(stylesXml, 'utf-8'));
  for (const img of imageParts) {
    zip.addFile(`word/media/${img.name}`, img.buffer);
  }

  zip.writeZip(path);
  console.log('[DOCX] 转换完成: ' + basename(path));
  // Cleanup — release buffer references to help GC
  for (const img of imageParts) {
    (img as any).buffer = undefined;
  }
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

    // Image ![alt](path) — standalone or inline
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const imgMatches = [...line.matchAll(imgRegex)];
    if (imgMatches.length > 0) {
      // Extract all images from this line
      for (const m of imgMatches) {
        blocks.push({ kind: 'image', alt: m[1], src: m[2] });
      }
      // If there's non-image text on the line, emit it as a paragraph
      const remaining = line.replace(imgRegex, '').trim();
      if (remaining) {
        // Remove the image syntax but keep alt text for context
        const cleaned = line.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1').trim();
        if (cleaned) blocks.push({ kind: 'para', text: stripFormatMarkers(cleaned) });
      }
      i++; continue;
    }

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
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
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

// ---- OOXML block converter ----

/** Convert a single markdown block to OOXML body XML */
function blockToDocxXml(
  block: MdBlock,
  imageDir: string,
  imageParts: { name: string; buffer: Buffer; rid: string }[],
): string {
  switch (block.kind) {
    case 'h1': return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${inlineToDocxRuns(block.text)}</w:p>`;
    case 'h2': return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${inlineToDocxRuns(block.text)}</w:p>`;
    case 'h3': return `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr>${inlineToDocxRuns(block.text)}</w:p>`;
    case 'para': {
      if (!block.text) return '';
      return `<w:p>${inlineToDocxRuns(block.text)}</w:p>`;
    }
    case 'code': {
      let xml = '';
      for (const line of block.lines) {
        xml += `<w:p><w:pPr><w:shd w:val="clear" w:fill="F0F0F0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(line || ' ')}</w:t></w:r></w:p>`;
      }
      return xml;
    }
    case 'image': {
      const img = loadDocxImage(block.src, imageDir);
      if (!img) {
        return `<w:p><w:r><w:rPr><w:i/><w:color w:val="999999"/></w:rPr><w:t>[图片: ${escapeXml(block.alt || basename(block.src))}]</w:t></w:r></w:p>`;
      }
      // Constrain to ~5in wide, maintain aspect ratio
      const EMU_PER_INCH = 914400;
      const maxW = Math.round(5.0 * EMU_PER_INCH);
      const wPx = detectImageWidth(img.buffer);
      const hPx = detectImageHeight(img.buffer, wPx);
      const ratio = hPx / Math.max(1, wPx);
      const imgW = maxW;
      const imgH = Math.round(maxW * ratio);
      // Generate unique image ID
      const imgIdx = imageParts.length + 1;
      const ext = (img.name || 'img.png').split('.').pop() || 'png';
      const mediaName = `image${imgIdx}.${ext}`;
      const rid = `rIdImg${imgIdx}`;
      imageParts.push({ name: mediaName, buffer: img.buffer, rid });

      // DrawingML inline image
      const extEmu = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : 'png';
      return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${imgW}" cy="${imgH}"/>
<wp:docPr id="${imgIdx}" name="Picture ${imgIdx}" descr="${escapeXml(block.alt)}"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic>
<pic:nvPicPr><pic:cNvPr id="0" name="Picture ${imgIdx}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${imgW}" cy="${imgH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic>
</a:graphicData>
</a:graphic>
</wp:inline></w:drawing></w:r></w:p>`;
    }
    case 'hr': {
      return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`;
    }
    case 'list': {
      let xml = '';
      for (const item of block.items) {
        xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>${inlineToDocxRuns(item)}</w:p>`;
      }
      return xml;
    }
    case 'table': {
      return buildDocxTable(block.headers, block.rows);
    }
    default: return '';
  }
}

/** Convert inline markdown text to OOXML <w:r> runs (bold, italic, code) */
function inlineToDocxRuns(text: string): string {
  // Strip HTML tags, keep <br> as line breaks
  const cleaned = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .trim();
  if (!cleaned) return `<w:r><w:t xml:space="preserve"></w:t></w:r>`;

  let xml = '';
  const segments = cleaned.split('\n');
  for (let si = 0; si < segments.length; si++) {
    if (si > 0) xml += '<w:r><w:br/></w:r>';
    xml += formatTextRuns(segments[si]);
  }
  return xml || `<w:r><w:t xml:space="preserve"></w:t></w:r>`;
}

/** Parse a text segment for bold, italic, code markers → OOXML runs */
function formatTextRuns(text: string): string {
  if (!text) return '';
  let xml = '';
  const re = /(\*\*(.+?)\*\*)|(__([^_]+)__)|(\*(.+?)\*)|(_([^_]+)_)|(`([^`]+)`)|([^*_`]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      xml += `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(m[2])}</w:t></w:r>`;
    } else if (m[3]) {
      xml += `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(m[4])}</w:t></w:r>`;
    } else if (m[5]) {
      xml += `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(m[6])}</w:t></w:r>`;
    } else if (m[7]) {
      xml += `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(m[8])}</w:t></w:r>`;
    } else if (m[9]) {
      xml += `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(m[10])}</w:t></w:r>`;
    } else if (m[11]) {
      xml += `<w:r><w:t xml:space="preserve">${escapeXml(m[11])}</w:t></w:r>`;
    }
  }
  return xml || `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** Build OOXML table from headers and rows */
function buildDocxTable(headers: string[], rows: string[][]): string {
  let xml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr>';
  // Header row
  xml += '<w:tr>';
  for (const h of headers) {
    xml += `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="E8E8E8"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(h)}</w:t></w:r></w:p></w:tc>`;
  }
  xml += '</w:tr>';
  // Data rows
  for (const row of rows) {
    xml += '<w:tr>';
    for (const cell of row) {
      xml += `<w:tc><w:p>${inlineToDocxRuns(cell)}</w:p></w:tc>`;
    }
    xml += '</w:tr>';
  }
  xml += '</w:tbl>';
  return xml;
}

/** Load an image file for DOCX embedding. Returns {name, buffer} or null. */
function loadDocxImage(src: string, imageDir: string): { name: string; buffer: Buffer } | null {
  let imgPath: string;
  if (existsSync(src)) {
    imgPath = src;
  } else {
    const candidate = join(imageDir, basename(src));
    if (existsSync(candidate)) {
      imgPath = candidate;
    } else {
      return null;
    }
  }
  try {
    const buf = readFileSync(imgPath);
    return { name: basename(imgPath), buffer: buf };
  } catch {
    return null;
  }
}

/** Quick image width detection (pixels) for aspect ratio calculation */
function detectImageWidth(buf: Buffer): number {
  try {
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf.readUInt32BE(16);
    if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
      let i = 2; const maxI = buf.length - 9;
      while (i < maxI) {
        if (buf[i] !== 0xFF) { i++; continue; }
        if (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2) return buf.readUInt16BE(i + 7);
        if (i + 4 >= buf.length) break;
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return 800; // fallback
}

function detectImageHeight(buf: Buffer, width: number): number {
  try {
    if (width > 0 && buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf.readUInt32BE(20);
    if (width > 0 && buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
      let i = 2; const maxI = buf.length - 9;
      while (i < maxI) {
        if (buf[i] !== 0xFF) { i++; continue; }
        if (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2) return buf.readUInt16BE(i + 5);
        if (i + 4 >= buf.length) break;
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return Math.round(width * 0.75);
}


function escapeXml(value: string): string {
  const safe = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  return safe.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch)
  );
}