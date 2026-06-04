'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFormats: () => ipcRenderer.invoke('get-formats'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  probeFile: (filePath) => ipcRenderer.invoke('probe-file', filePath),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  detectFileType: (filePath) => ipcRenderer.invoke('detect-file-type', filePath),
  detectSequence: (files) => ipcRenderer.invoke('detect-sequence', files),
  startConvert: (options) => ipcRenderer.invoke('start-convert', options),
  revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  getTempDir: () => ipcRenderer.invoke('get-temp-dir'),
  // Electron 32+ 需要用 webUtils.getPathForFile 代替 file.path
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    ipcRenderer.on('convert-progress', (event, data) => callback(data));
  },
  onLog: (callback) => {
    ipcRenderer.on('convert-log', (event, data) => callback(data));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  onMenuEvent: (channel, callback) => {
    const allowed = [
      'menu-select-files','menu-select-folder','menu-select-output',
      'update-downloading','update-progress','update-downloaded'
    ];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, data) => callback(data));
  },

  // ── Download APIs ──────────────────────────────────────────────────────────
  getYtdlpStatus: () => ipcRenderer.invoke('get-ytdlp-status'),
  installYtdlp: () => ipcRenderer.invoke('install-ytdlp'),
  downloadUrl: (options) => ipcRenderer.invoke('download-url', options),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),

  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  onDownloadLog: (callback) => {
    ipcRenderer.on('download-log', (event, data) => callback(data));
  },
  onYtdlpInstallProgress: (callback) => {
    ipcRenderer.on('ytdlp-install-progress', (event, data) => callback(data));
  },

  // ── 加密音乐解密 ──────────────────────────────────────────────────────────
  isEncryptedAudio: (filePath) => ipcRenderer.invoke('music:is-encrypted', filePath),
  getEncryptedExts: () => ipcRenderer.invoke('music:get-encrypted-exts'),
  decryptMusic: (inputPath, outputDir) => ipcRenderer.invoke('music:decrypt', { inputPath, outputDir }),
  openUnlockMusicWindow: () => ipcRenderer.invoke('music:open-unlock-window')
});
