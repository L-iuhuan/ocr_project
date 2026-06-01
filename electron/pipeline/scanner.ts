import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, realpathSync } from 'fs';
import { extname, basename, join, resolve } from 'path';
import { createHash } from 'crypto';
import { FileInfo, FileType } from '../types';

const SUPPORTED_EXTENSIONS: Record<string, FileType> = {
  '.pdf': 'pdf', '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.jp2': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image',
  '.tif': 'image', '.tiff': 'image', '.pptx': 'pptx', '.ppt': 'ppt',
  '.docx': 'docx', '.doc': 'doc', '.xlsx': 'xlsx', '.txt': 'txt',
  '.wps': 'wps', '.ofd': 'ofd'
};

const MAX_SCAN_DEPTH = 20;
// Read only first 4MB for hashing — use streaming read to avoid loading entire file
const HASH_READ_SIZE = 4 * 1024 * 1024;

/**
 * Compute SHA-256 of first 4MB of a file using streaming reads.
 * Avoids loading the entire file into memory.
 */
function sha256First4MB(filePath: string): string {
  const hash = createHash('sha256');
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(HASH_READ_SIZE);
    const bytesRead = readSync(fd, buf, 0, buf.length, 0);
    hash.update(buf.subarray(0, bytesRead));
  } catch {
    // If streaming read fails (e.g. permission), fall back to empty hash
    return '';
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
  return hash.digest('hex');
}

/**
 * Recursively scan a directory for supported files.
 * Uses realpath dedup to prevent infinite loops from symlinks/junctions.
 * Depth-limited to MAX_SCAN_DEPTH to catch any remaining edge cases.
 */
function scanDirectory(dirPath: string, visited = new Set<string>(), depth = 0): string[] {
  if (depth > MAX_SCAN_DEPTH) {
    console.warn(`[Scanner] Max depth ${MAX_SCAN_DEPTH} reached at "${dirPath}" — stopping recursion`);
    return [];
  }

  // Resolve real path to detect symlink loops
  let realPath: string;
  try {
    realPath = realpathSync(dirPath);
  } catch {
    // realpathSync fails on paths that don't exist or have permission issues
    return [];
  }
  if (visited.has(realPath)) return [];
  visited.add(realPath);

  const results: string[] = [];
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanDirectory(fullPath, visited, depth + 1));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS[ext]) results.push(fullPath);
      }
      // Skip symlinks that point to files — isFile() returns true for file symlinks
      // but the target might be a duplicate. The dedup hash will handle it.
    }
  } catch { /* permission denied, skip */ }
  return results;
}

export function scanFiles(paths: string[]): FileInfo[] {
  const fileMap = new Map<string, FileInfo[]>();

  // 1. Collect all files
  const allFiles: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    let stat;
    try {
      stat = statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      allFiles.push(...scanDirectory(p));
    } else {
      const ext = extname(p).toLowerCase();
      if (SUPPORTED_EXTENSIONS[ext]) allFiles.push(p);
    }
  }

  // 2. Compute info + dedup (by hash + size for better accuracy)
  for (const fp of allFiles) {
    const name = basename(fp);
    const ext = extname(fp).toLowerCase();
    const type = SUPPORTED_EXTENSIONS[ext];
    let sizeBytes: number;
    try {
      sizeBytes = statSync(fp).size;
    } catch {
      continue; // Skip files that became inaccessible
    }
    const hash = sha256First4MB(fp);

    // Use hash + file size as composite key for dedup
    const dedupKey = hash ? `${hash}_${sizeBytes}` : `${fp}_${sizeBytes}`;

    const info: FileInfo = {
      path: fp,
      name,
      type,
      sizeBytes,
      pageCount: 0,
      sha256: hash
    };

    if (!fileMap.has(dedupKey)) {
      fileMap.set(dedupKey, [info]);
    } else {
      const existing = fileMap.get(dedupKey)!;
      // Same hash + size → likely duplicate (different path)
      const sameName = existing.find(e => e.name === name);
      if (sameName) {
        // Same name, update path (keep the latest)
        sameName.path = fp;
      } else {
        // Different name, same content — treat as separate file with disambiguated name
        const newName = name.replace(ext, `_${existing.length}${ext}`);
        info.name = newName;
        // Use a unique key to keep it in the result
        fileMap.set(dedupKey + `_dup${existing.length}`, [info]);
      }
    }
  }

  // 3. Flatten to array
  const result: FileInfo[] = [];
  for (const [, infos] of fileMap) {
    result.push(...infos);
  }

  return result;
}
