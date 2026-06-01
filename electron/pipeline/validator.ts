import { Chunk, Task } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate task readiness and content integrity.
 * Phase 3b: Run before merging to catch issues early.
 */
export function validateTask(task: Task): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Task-level checks
  if (!task.jobId) {
    errors.push('Task missing jobId');
  }
  if (!task.originalName) {
    errors.push('Task missing originalName');
  }
  if (task.chunks.length === 0) {
    errors.push('Task has no chunks');
  }

  // 2. Chunk-level checks
  const doneChunks = task.chunks.filter(c => c.chunkState === 'done');
  const failedChunks = task.chunks.filter(c => c.chunkState === 'failed');

  if (doneChunks.length === 0 && failedChunks.length > 0) {
    errors.push('All chunks failed — no output to merge');
  }

  for (const chunk of doneChunks) {
    const result = validateChunk(chunk, task);
    if (!result.valid) {
      errors.push(
        `Chunk ${chunk.chunkSequence + 1}: ${result.errors.join('; ')}`
      );
    }
    warnings.push(...result.warnings.map(w => `Chunk ${chunk.chunkSequence + 1}: ${w}`));
  }

  // 3. Sequence check
  const sequences = task.chunks.map(c => c.chunkSequence).sort((a, b) => a - b);
  for (let i = 0; i < sequences.length - 1; i++) {
    if (sequences[i + 1] !== sequences[i] + 1) {
      warnings.push(
        `Non-consecutive chunk sequences: ${sequences[i]} → ${sequences[i + 1]}`
      );
      break;
    }
  }

  // 4. Output directory check
  if (!task.outputDir) {
    errors.push('Task missing outputDir');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a single chunk result.
 */
export function validateChunk(
  chunk: Chunk,
  task: Task
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (chunk.chunkState === 'failed') {
    return {
      valid: false,
      errors: [chunk.errorMsg || chunk.errorCode || 'Unknown failure'],
      warnings: [],
    };
  }

  if (chunk.chunkState !== 'done') {
    warnings.push(`Chunk state is "${chunk.chunkState}", not "done"`);
    return { valid: false, errors: [], warnings };
  }

  // Check result URL exists
  if (!chunk.resultUrl) {
    errors.push('No resultUrl — chunk appears done but has no output path');
    return { valid: false, errors, warnings };
  }

  // Check file exists (requires fs)
  try {
    const { existsSync, statSync, readFileSync } = require('fs');
    if (!existsSync(chunk.resultUrl)) {
      errors.push(`Result file not found: ${chunk.resultUrl}`);
      return { valid: false, errors, warnings };
    }

    const stat = statSync(chunk.resultUrl);
    if (stat.size === 0) {
      errors.push(`Result file is empty: ${chunk.resultUrl}`);
      return { valid: false, errors, warnings };
    }

    // Check content is readable text
    try {
      const content = readFileSync(chunk.resultUrl, 'utf-8').trim();
      if (content.length === 0) {
        errors.push(`Result file has no content: ${chunk.resultUrl}`);
        return { valid: false, errors, warnings };
      }
      if (content.length < 10) {
        warnings.push(
          `Result content is very short (${content.length} chars) — possible extraction issue`
        );
      }
    } catch {
      errors.push(`Result file is not readable as text: ${chunk.resultUrl}`);
      return { valid: false, errors, warnings };
    }
  } catch {
    // If fs module fails, skip file checks (should not happen in main process)
    warnings.push('Could not verify result file on disk');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Check if two chunks have overlapping page ranges.
 */
export function detectOverlap(chunks: Chunk[]): boolean {
  const ranges = chunks
    .filter(c => c.pageStart != null && c.pageEnd != null)
    .sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0));

  for (let i = 0; i < ranges.length - 1; i++) {
    const current = ranges[i];
    const next = ranges[i + 1];
    if (
      current.pageEnd != null &&
      next.pageStart != null &&
      current.pageEnd >= next.pageStart
    ) {
      return true;
    }
  }
  return false;
}
