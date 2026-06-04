'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 强制设置应用名称（开发模式下覆盖 Electron 默认名）
app.setName('M-SHIFT');

// macOS：设置 Dock 图标
if (process.platform === 'darwin') {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.icns');
  if (fs.existsSync(iconPath)) {
    try { app.dock.setIcon(iconPath); } catch(e) {}
  }
}

const { FORMATS, detectFileType, detectImageSequence, probeFile, convert, buildSequencePattern } = require('./converter');
const { initUpdater, checkForUpdates } = require('./updater');
const { getYtdlpStatus, installYtdlp, downloadUrl, cancelDownload } = require('./downloader');
const { isEncryptedAudio, decryptToFile, ENCRYPTED_EXTS } = require('./musicDecrypt');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'build', 'icon.icns'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    initUpdater(mainWindow);
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  buildMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Chinese Menu ─────────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    // macOS 应用菜单（第一项）
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: `关于 M-SHIFT`, role: 'about' },
        { type: 'separator' },
        { label: '检查更新…', click: () => checkForUpdates(false) },
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: `隐藏 M-SHIFT`, role: 'hide', accelerator: 'Command+H' },
        { label: '隐藏其他', role: 'hideOthers', accelerator: 'Option+Command+H' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: '退出 M-SHIFT', role: 'quit', accelerator: 'Command+Q' }
      ]
    }] : []),
    // 文件
    {
      label: '文件',
      submenu: [
        {
          label: '导入文件…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow && mainWindow.webContents.send('menu-select-files')
        },
        {
          label: '导入文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow && mainWindow.webContents.send('menu-select-folder')
        },
        { type: 'separator' },
        {
          label: '选择输出目录…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow && mainWindow.webContents.send('menu-select-output')
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: '退出', role: 'quit', accelerator: 'Alt+F4' }])
      ]
    },
    // 编辑
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { label: '重做', role: 'redo', accelerator: 'Shift+CmdOrCtrl+Z' },
        { type: 'separator' },
        { label: '剪切', role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { label: '复制', role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { label: '粘贴', role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { label: '全选', role: 'selectAll', accelerator: 'CmdOrCtrl+A' }
      ]
    },
    // 视图
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { label: '强制重新加载', role: 'forceReload', accelerator: 'Shift+CmdOrCtrl+R' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        { label: '放大', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { label: '缩小', role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen', accelerator: isMac ? 'Ctrl+Command+F' : 'F11' }
      ]
    },
    // 窗口
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize', accelerator: 'CmdOrCtrl+M' },
        ...(isMac ? [
          { label: '缩放', role: 'zoom' },
          { type: 'separator' },
          { label: '前置所有窗口', role: 'front' }
        ] : [
          { label: '关闭', role: 'close', accelerator: 'CmdOrCtrl+W' }
        ])
      ]
    },
    // 帮助
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => checkForUpdates(false)
        },
        { type: 'separator' },
        {
          label: '关于 M-SHIFT',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 M-SHIFT',
              message: 'M-SHIFT',
              detail: `版本：${app.getVersion()}\n基于 FFmpeg 构建的多格式媒体转换工具\n支持视频、图片、音频互相转换`
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Get all supported formats
ipcMain.handle('get-formats', () => FORMATS);

// Select input files
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Media Files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Media', extensions: ['mp4','mov','avi','mkv','flv','webm','mpg','mpeg','m4v','ts','3gp','gif',
          'jpg','jpeg','png','bmp','tiff','tif','webp','tga','dpx','exr','hdr','ppm','pgm','ico','avif','heic',
          'mp3','aac','wav','flac','ogg','opus','m4a','aiff'] },
      { name: 'Video', extensions: ['mp4','mov','avi','mkv','flv','webm','mpg','mpeg','m4v','ts','3gp','gif'] },
      { name: 'Image', extensions: ['jpg','jpeg','png','bmp','tiff','tif','webp','tga','dpx','exr','hdr','ppm','pgm','ico','avif','heic'] },
      { name: 'Audio', extensions: ['mp3','aac','wav','flac','ogg','opus','m4a','aiff'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePaths;
});

// Select input folder (for image sequences)
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Image Sequence Folder',
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  const folderPath = result.filePaths[0];
  const files = fs.readdirSync(folderPath)
    .filter(f => !f.startsWith('.'))
    .map(f => path.join(folderPath, f))
    .sort();
  return { folderPath, files };
});

// Probe file metadata
ipcMain.handle('probe-file', async (event, filePath) => {
  try {
    const meta = await probeFile(filePath);
    return { success: true, data: meta };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Select output directory
ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Output Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Detect file type
ipcMain.handle('detect-file-type', (event, filePath) => {
  return detectFileType(filePath);
});

// Detect image sequence in file list
ipcMain.handle('detect-sequence', (event, files) => {
  return detectImageSequence(files);
});

// Start conversion
ipcMain.handle('start-convert', async (event, options) => {
  const {
    inputFiles,
    outputDir,
    outputName,
    format,
    settings,
    isSequence,
    inputFps
  } = options;

  try {
    const ext = format.ext;
    // 只取文件名部分，防止 Windows 路径分隔符混入 outputName
    const safeName = path.basename(outputName.replace(/\\/g, '/'));
    const outputPath = path.join(outputDir, `${safeName}.${ext}`);

    let sequencePattern = null;
    if (isSequence) {
      sequencePattern = buildSequencePattern(inputFiles);
      if (!sequencePattern) {
        return { success: false, error: 'Could not detect sequence pattern from file names' };
      }
    }

    const outputResult = await convert(
      {
        inputFiles,
        outputPath,
        format,
        settings: { ...settings, fps: settings.fps || inputFps },
        isSequence,
        sequencePattern,
        fps: inputFps || 24
      },
      (progressData) => {
        mainWindow.webContents.send('convert-progress', progressData);
      },
      (log) => {
        mainWindow.webContents.send('convert-log', log);
      }
    );

    // ICNS 转换返回实际路径，其他格式返回 outputPath
    const finalPath = (typeof outputResult === 'string' && outputResult) ? outputResult : outputPath;
    return { success: true, outputPath: finalPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Reveal file in finder/explorer
ipcMain.handle('reveal-file', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Open file with default app
ipcMain.handle('open-file', (event, filePath) => {
  shell.openPath(filePath);
});

// Get temp dir
ipcMain.handle('get-temp-dir', () => os.tmpdir());

// ─── Download IPC Handlers ────────────────────────────────────────────────────

// Get yt-dlp install status
ipcMain.handle('get-ytdlp-status', async () => {
  return await getYtdlpStatus();
});

// Install / update yt-dlp
ipcMain.handle('install-ytdlp', async () => {
  return await installYtdlp(
    (prog) => {
      if (mainWindow) mainWindow.webContents.send('ytdlp-install-progress', prog);
    },
    (log) => {
      if (mainWindow) mainWindow.webContents.send('download-log', log);
    }
  );
});

// Download URL via yt-dlp
ipcMain.handle('download-url', async (event, options) => {
  return await downloadUrl(
    options,
    (prog) => {
      if (mainWindow) mainWindow.webContents.send('download-progress', prog);
    },
    (log) => {
      if (mainWindow) mainWindow.webContents.send('download-log', log);
    }
  );
});

// Cancel ongoing download
ipcMain.handle('cancel-download', () => {
  cancelDownload();
});

// 加密音乐：判别与解密
ipcMain.handle('music:is-encrypted', (event, filePath) => {
  return isEncryptedAudio(filePath);
});

ipcMain.handle('music:get-encrypted-exts', () => ENCRYPTED_EXTS);

ipcMain.handle('music:decrypt', async (event, { inputPath, outputDir }) => {
  // outputDir 未传时默认使用 userData/music-decrypt-tmp
  const dir = outputDir || path.join(app.getPath('userData'), 'music-decrypt-tmp');
  return await decryptToFile(inputPath, dir);
});

// 打开 unlock-music web 窗口
let unlockWindow = null;
ipcMain.handle('music:open-unlock-window', () => {
  if (unlockWindow && !unlockWindow.isDestroyed()) {
    unlockWindow.focus();
    return;
  }
  unlockWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: '加密音乐解锁 - Unlock Music',
    parent: mainWindow,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  unlockWindow.loadURL('https://demo.unlock-music.dev/');
  unlockWindow.on('closed', () => { unlockWindow = null; });
});
