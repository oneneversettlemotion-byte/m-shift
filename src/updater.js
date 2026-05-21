'use strict';

const { autoUpdater } = require('electron-updater');
const { dialog, shell, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// 关闭自动下载，让用户确认后再下
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// 开发环境跳过更新（避免报错）
if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
  autoUpdater.forceDevUpdateConfig = false;
}

const { app } = require('electron');
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 一周
const STATE_FILE = path.join(app.getPath('userData'), 'update-state.json');

function readLastCheck() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).lastCheck || 0; }
  catch { return 0; }
}

function saveLastCheck() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ lastCheck: Date.now() })); }
  catch {}
}

let mainWin = null;

// ─── 初始化 ────────────────────────────────────────────────────────────────
function initUpdater(win) {
  mainWin = win;

  // 启动 10 秒后判断是否该检查（距上次检查超过一周才检查）
  setTimeout(() => {
    const elapsed = Date.now() - readLastCheck();
    if (elapsed >= CHECK_INTERVAL_MS) {
      checkForUpdates(true);
    }

    // 此后每小时轮询一次，但只有距上次检查满一周才真正发起请求
    setInterval(() => {
      const elapsed2 = Date.now() - readLastCheck();
      if (elapsed2 >= CHECK_INTERVAL_MS) checkForUpdates(true);
    }, 60 * 60 * 1000);
  }, 10 * 1000);

  // 找到新版本
  autoUpdater.on('update-available', (info) => {
    notifyNewVersion(info);
  });

  // 没有新版本（手动检查时才弹提示）
  autoUpdater.on('update-not-available', () => {
    if (!autoUpdater._silentCheck) {
      dialog.showMessageBox(mainWin, {
        type: 'info',
        title: '已是最新版本',
        message: 'M-SHIFT 已是最新版本',
        detail: `当前版本：${require('electron').app.getVersion()}`,
        buttons: ['好']
      });
    }
  });

  // 下载进度 → 发给渲染层
  autoUpdater.on('download-progress', (progress) => {
    mainWin && mainWin.webContents.send('update-progress', {
      percent: Math.round(progress.percent),
      transferred: formatBytes(progress.transferred),
      total: formatBytes(progress.total),
      bytesPerSecond: formatBytes(progress.bytesPerSecond) + '/s'
    });
  });

  // 下载完毕
  autoUpdater.on('update-downloaded', () => {
    mainWin && mainWin.webContents.send('update-downloaded');
    dialog.showMessageBox(mainWin, {
      type: 'info',
      title: '更新就绪',
      message: '新版本已下载完成',
      detail: '点击"立即重启"以完成安装，或下次启动时自动安装。',
      buttons: ['立即重启', '稍后安装'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  // 错误处理
  autoUpdater.on('error', (err) => {
    if (!autoUpdater._silentCheck) {
      dialog.showMessageBox(mainWin, {
        type: 'warning',
        title: '检查更新失败',
        message: '无法连接到更新服务器',
        detail: err.message,
        buttons: ['好']
      });
    }
  });

  // IPC：渲染层请求"立即重启安装"
  ipcMain.on('update-install-now', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

// ─── 检查更新 ──────────────────────────────────────────────────────────────
function checkForUpdates(silent = false) {
  autoUpdater._silentCheck = silent;
  saveLastCheck(); // 记录本次检查时间，无论成功与否
  try {
    autoUpdater.checkForUpdates();
  } catch (e) {
    // 开发环境或未配置 publish 时静默忽略
  }
}

// ─── 弹出新版本提示 ────────────────────────────────────────────────────────
function notifyNewVersion(info) {
  const notes = info.releaseNotes
    ? (typeof info.releaseNotes === 'string' ? info.releaseNotes : info.releaseNotes.map(n => n.note).join('\n'))
    : '本次更新包含功能优化与问题修复。';

  dialog.showMessageBox(mainWin, {
    type: 'info',
    title: '发现新版本',
    message: `M-SHIFT ${info.version} 可供更新`,
    detail: `当前版本：${require('electron').app.getVersion()}\n\n更新内容：\n${notes}`,
    buttons: ['立即下载', '稍后提醒'],
    defaultId: 0,
    cancelId: 1
  }).then(({ response }) => {
    if (response === 0) {
      mainWin && mainWin.webContents.send('update-downloading');
      autoUpdater.downloadUpdate();
    }
  });
}

// ─── 工具 ──────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = { initUpdater, checkForUpdates };
