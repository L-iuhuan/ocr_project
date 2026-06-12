import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  platform: process.platform,

  // Window controls (frameless)
  winMinimize: () => ipcRenderer.send('win-minimize'),
  winMaximize: () => ipcRenderer.send('win-maximize'),
  winClose: () => ipcRenderer.send('win-close'),

  addFiles: (paths: string[]) => ipcRenderer.invoke('add-files', paths),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  pauseQueue: () => ipcRenderer.send('pause-queue'),
  resumeQueue: () => ipcRenderer.send('resume-queue'),
  cancelTask: (jobId: string) => ipcRenderer.send('cancel-task', jobId),
  retryTask: (jobId: string) => ipcRenderer.send('retry-task', jobId),
  removeTask: (jobId: string) => ipcRenderer.send('remove-task', jobId),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  openOutputDir: (dirPath?: string) => ipcRenderer.invoke('open-output-dir', dirPath),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  getDefaultSettings: () => ipcRenderer.invoke('get-default-settings'),
  getProviderStatus: () => ipcRenderer.invoke('get-provider-status'),
  testProviderConnection: (type: string, creds: unknown) => ipcRenderer.invoke('test-provider', type, creds),
  setProviderPriority: (providers: string[]) => ipcRenderer.send('set-provider-priority', providers),
  getProviderQuotas: () => ipcRenderer.invoke('get-quotas'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onTasksUpdate: (cb: (tasks: unknown[]) => void) => {
    const handler = (_: unknown, tasks: unknown[]) => cb(tasks);
    ipcRenderer.on('tasks-update', handler);
    return () => ipcRenderer.removeListener('tasks-update', handler);
  },
  onLog: (cb: (log: unknown) => void) => {
    const handler = (_: unknown, log: unknown) => cb(log);
    ipcRenderer.on('log-entry', handler);
    return () => ipcRenderer.removeListener('log-entry', handler);
  },
  onProgress: (cb: (progress: unknown) => void) => {
    const handler = (_: unknown, progress: unknown) => cb(progress);
    ipcRenderer.on('progress-update', handler);
    return () => ipcRenderer.removeListener('progress-update', handler);
  },
  onQuotasUpdate: (cb: (quotas: unknown[]) => void) => {
    const handler = (_: unknown, quotas: unknown[]) => cb(quotas);
    ipcRenderer.on('quotas-update', handler);
    return () => ipcRenderer.removeListener('quotas-update', handler);
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
