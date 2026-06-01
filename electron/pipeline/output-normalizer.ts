import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { OutputFormat } from '../types';
import { ParsedChunkResult } from '../providers/i-provider';

export interface NormalizedOutput {
  markdown: string;
  json: Record<string, unknown> | null;
  images: Record<string, string>;
  raw: ParsedChunkResult;
}

/**
 * Normalize a provider's raw chunk result into a uniform structure.
 * Different providers return different formats:
 *   MinerU Precision → ZIP with .md files
 *   MinerU Agent → direct markdown_url
 *   PaddleOCR Cloud → JSONL with layoutParsingResults
 *   Local OCR → layoutParsingResults array
 */
export function normalizeChunkResult(
  result: ParsedChunkResult,
  sourceProvider: string
): NormalizedOutput {
  const markdown = result.markdown ?? extractMarkdownFromRaw(result);
  const json = result.json ?? null;
  const images = result.images ?? {};

  return { markdown, json, images, raw: result };
}

/**
 * Convert merged markdown to a specific output format.
 */
export function convertFormat(
  markdown: string,
  format: OutputFormat,
  metadata?: { title?: string }
): string {
  switch (format) {
    case 'md':
      return markdown;
    case 'json':
      return JSON.stringify({ content: markdown, ...metadata }, null, 2);
    case 'html':
      return markdownToHtml(markdown, metadata?.title);
    case 'docx':
      // DOCX conversion is handled by merger.ts (AdmZip-based)
      return markdown;
    default:
      return markdown;
  }
}

// ---- Internal helpers ----

function extractMarkdownFromRaw(result: ParsedChunkResult): string {
  // Try reading from rawPath if it's a .md file
  if (result.rawPath) {
    try {
      const content = readFileSync(result.rawPath, 'utf-8').trim();
      if (content) return content;
    } catch (err: any) {
      // Log the failure so it's not silently lost
      console.warn(`[OutputNormalizer] Failed to read markdown from rawPath "${result.rawPath}": ${err.message || err}`);
    }
  }
  return '';
}

/**
 * Basic markdown-to-HTML conversion.
 * For production use, consider using a library like marked or markdown-it.
 */
function markdownToHtml(markdown: string, title?: string): string {
  const htmlBody = markdown
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      // Headers
      if (/^#{1,6}\s/.test(trimmed)) {
        const level = trimmed.match(/^(#{1,6})/)![1].length;
        const text = escapeHtml(trimmed.replace(/^#{1,6}\s*/, ''));
        return `<h${level}>${text}</h${level}>`;
      }
      // Horizontal rule
      if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
        return '<hr>';
      }
      // Unordered list
      if (/^[-*+]\s/.test(trimmed)) {
        const text = escapeHtml(trimmed.replace(/^[-*+]\s*/, ''));
        return `<li>${text}</li>`;
      }
      // Ordered list
      if (/^\d+\.\s/.test(trimmed)) {
        const text = escapeHtml(trimmed.replace(/^\d+\.\s*/, ''));
        return `<li>${text}</li>`;
      }
      // Code block markers are kept as-is since we don't track block state
      if (trimmed.startsWith('```')) {
        return '<hr>';
      }
      // Blockquote
      if (trimmed.startsWith('>')) {
        const text = escapeHtml(trimmed.replace(/^>\s*/, ''));
        return `<blockquote><p>${text}</p></blockquote>`;
      }
      // Empty line
      if (!trimmed) {
        return '<br>';
      }
      // Regular paragraph
      return `<p>${escapeHtml(line) || '&nbsp;'}</p>`;
    })
    .join('\n  ');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || 'OCRFlow Output')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; line-height: 1.7; margin: 40px auto; max-width: 900px; padding: 0 24px; color: #1a1a2e; background: #fff; }
    pre { background: #f5f5f5; border-radius: 6px; padding: 16px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-size: 14px; }
    code { font-family: "Fira Code", "Cascadia Code", monospace; font-size: 0.9em; }
    h1 { font-size: 1.8em; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
    h2 { font-size: 1.4em; }
    h3 { font-size: 1.15em; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f0f0f0; }
    hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    blockquote { border-left: 3px solid #ccc; padding-left: 16px; color: #666; margin: 12px 0; }
  </style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch)
  );
}
