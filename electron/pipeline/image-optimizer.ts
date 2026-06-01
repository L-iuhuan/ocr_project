/**
 * Image optimization using sharp.
 * Used by the preprocessor / splitter to compress images that exceed provider limits.
 */
import sharp from 'sharp';
import { statSync } from 'fs';
import { basename, extname, join } from 'path';
import { getTempDir } from '../state-manager';

export interface CompressionOptions {
  maxWidth?: number;          // default 4096
  maxHeight?: number;         // default 4096
  quality?: number;           // default 85 (0-100)
  maxSizeBytes?: number;      // target max file size
  format?: 'jpeg' | 'png' | 'webp';  // output format
}

const DEFAULTS: Required<CompressionOptions> = {
  maxWidth: 4096,
  maxHeight: 4096,
  quality: 85,
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  format: 'jpeg',
};

/**
 * Compress an image file to fit within provider constraints.
 * Returns path to compressed file (in temp dir).
 * If the file is already within limits, returns the original path.
 * If compression fails (corrupt image, unsupported format), returns the original path.
 */
export async function compressImage(
  filePath: string,
  options: CompressionOptions = {}
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  const ext = extname(filePath).toLowerCase();

  // Only process image types
  const imageExts = ['.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.tif', '.tiff'];
  if (!imageExts.includes(ext)) {
    return filePath;
  }

  let originalSize: number;
  try {
    originalSize = statSync(filePath).size;
  } catch {
    return filePath; // Can't stat — skip
  }

  // If already under the limit, skip compression
  if (originalSize <= opts.maxSizeBytes) {
    return filePath;
  }

  // Read metadata and attempt compression
  try {
    const meta = await sharp(filePath).metadata();
    const { width = 99999, height = 99999 } = meta;

    // Skip if dimensions are reasonable and size is only slightly over
    if (width <= opts.maxWidth && height <= opts.maxHeight && originalSize <= opts.maxSizeBytes * 1.5) {
      return filePath;
    }

    const tempDir = getTempDir();
    const baseName = basename(filePath, ext);
    const outPath = join(tempDir, `${baseName}_compressed.${opts.format}`);

    let pipeline = sharp(filePath)
      .resize({
        width: Math.min(width, opts.maxWidth),
        height: Math.min(height, opts.maxHeight),
        fit: 'inside',
        withoutEnlargement: true,
      });

    // Convert to target format
    switch (opts.format) {
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality: opts.quality, progressive: true });
        break;
      case 'png':
        pipeline = pipeline.png({ quality: opts.quality, compressionLevel: 9 });
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality: opts.quality });
        break;
    }

    await pipeline.toFile(outPath);

    const compressedSize = statSync(outPath).size;
    if (compressedSize >= originalSize) {
      // Compression didn't help, return original
      return filePath;
    }

    return outPath;
  } catch (err: any) {
    // sharp throws on corrupt / non-standard image formats.
    // Log and return original — don't let one bad image fail the entire task.
    console.warn(`[ImageOptimizer] Failed to compress "${filePath}": ${err.message || err}. Using original.`);
    return filePath;
  }
}

/**
 * Compress a PDF file by converting its embedded images to lower quality.
 * Only applies when the file exceeds the size limit.
 */
export async function compressPdfIfNeeded(
  filePath: string,
  maxSizeMB: number
): Promise<string> {
  const maxBytes = maxSizeMB * 1024 * 1024;
  let originalSize: number;
  try {
    originalSize = statSync(filePath).size;
  } catch {
    return filePath;
  }
  if (originalSize <= maxBytes) return filePath;

  // For now, PDF compression returns original (pdf-lib + sharp is complex).
  // The file will be split into chunks which effectively reduces per-chunk size.
  // Full PDF recompression would require ghostscript or similar, which is out of scope.
  return filePath;
}

/**
 * Check if an image is within provider limits.
 */
export function isImageWithinLimits(
  filePath: string,
  maxSizeMB: number,
  maxDimension?: number
): { within: boolean; sizeBytes: number; reason?: string } {
  let sizeBytes: number;
  try {
    sizeBytes = statSync(filePath).size;
  } catch {
    return { within: false, sizeBytes: 0, reason: 'Cannot stat file' };
  }

  if (sizeBytes > maxSizeMB * 1024 * 1024) {
    return { within: false, sizeBytes, reason: `File too large: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB > ${maxSizeMB}MB` };
  }
  return { within: true, sizeBytes };
}
