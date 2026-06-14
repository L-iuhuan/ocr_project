// Shared state constants used across multiple UI components.
// Mirrors the server-side RUNNING_STATES in electron/task-worker.ts.

export const RUNNING_STATUSES = ['running', 'preprocessing', 'uploading', 'downloading', 'merging'];
export const QUEUED_STATUSES = ['pending', 'paused'];
