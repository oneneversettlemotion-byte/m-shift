'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');

// 解析 ffmpeg 路径（与 converter.js 逻辑一致）
function resolveUnpacked(p) {
  if (!p) return p;
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
}
let ffmpegPath = null;
try {
  ffmpegPath = resolveUnpacked(require('ffmpeg-static'));
} catch (e) {
  try {
    ffmpegPath = resolveUnpacked(require('@ffmpeg-installer/ffmpeg').path);
  } catch (e2) {
    ffmpegPath = null;
  }
}

// yt-dlp 二进制名称（按平台）
function getYtdlpBinaryName() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') return 'yt-dlp.exe';
  if (plat === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp'; // linux
}

// yt-dlp 存放目录：userData/yt-dlp/
function getYtdlpDir() {
  try {
    return path.join(app.getPath('userData'), 'yt-dlp');
  } catch (e) {
    return path.join(os.homedir(), '.m-shift', 'yt-dlp');
  }
}

function getYtdlpPath() {
  return path.join(getYtdlpDir(), getYtdlpBinaryName());
}

// 检测本地 yt-dlp 是否存在且可执行
function checkYtdlpLocal() {
  const p = getYtdlpPath();
  return fs.existsSync(p);
}

// 获取 yt-dlp 版本字符串（拿不到也无所谓，只用于显示）
function getYtdlpVersion(ytdlpPath) {
  return new Promise((resolve) => {
    try {
      const proc = spawn(ytdlpPath, ['--version']);
      let out = '';
      proc.stdout.on('data', d => out += d.toString());
      proc.on('close', () => resolve(out.trim() || null));
      proc.on('error', () => resolve(null));
      // 自行超时：15s（macOS Gatekeeper 首次校验可能慢）
      setTimeout(() => {
        try { proc.kill(); } catch (e) {}
        resolve(out.trim() || null);
      }, 15000);
    } catch (e) {
      resolve(null);
    }
  });
}

// 下载文件，带进度回调
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    const doRequest = (reqUrl) => {
      protocol.get(reqUrl, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.destroy();
          downloadFile(res.headers.location, destPath, onProgress)
            .then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.destroy();
          fs.unlink(destPath, () => {});
          reject(new Error(`下载失败，HTTP ${res.statusCode}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          if (total > 0 && onProgress) {
            onProgress({ percent: Math.round((downloaded / total) * 100), downloaded, total });
          }
        });

        res.on('end', () => {
          file.end();
          resolve(destPath);
        });

        res.on('error', (err) => {
          file.destroy();
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        file.destroy();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };

    doRequest(url);
  });
}

// 安装 yt-dlp（下载二进制到 userData）
async function installYtdlp(onProgress, onLog) {
  const dir = getYtdlpDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const binaryName = getYtdlpBinaryName();
  const destPath = path.join(dir, binaryName);
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;

  if (onLog) onLog({ type: 'info', message: `正在下载 yt-dlp: ${downloadUrl}` });

  try {
    await downloadFile(downloadUrl, destPath, (prog) => {
      if (onProgress) onProgress(prog);
      if (onLog) onLog({ type: 'progress', message: `下载 yt-dlp: ${prog.percent}%` });
    });

    // 赋予可执行权限（Unix）
    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, 0o755);
    }

    const version = await getYtdlpVersion(destPath);
    if (onLog) onLog({ type: 'success', message: `yt-dlp 安装完成 v${version}` });
    return { success: true, version, path: destPath };
  } catch (e) {
    if (onLog) onLog({ type: 'error', message: `安装 yt-dlp 失败: ${e.message}` });
    return { success: false, error: e.message };
  }
}

// 获取 yt-dlp 状态
async function getYtdlpStatus() {
  // 1. 检查本地缓存：文件存在即视为已安装（version 失败不影响功能）
  const localPath = getYtdlpPath();
  if (checkYtdlpLocal()) {
    const version = await getYtdlpVersion(localPath);
    return { installed: true, version: version || 'unknown', path: localPath };
  }
  // 2. 检查系统 PATH
  const systemCmd = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const version = await getYtdlpVersion(systemCmd);
  if (version) return { installed: true, version, path: systemCmd };

  return { installed: false, version: null, path: null };
}

// 当前下载进程引用（用于取消）
let currentDownloadProc = null;

// 解析 yt-dlp 输出，提取进度信息
function parseProgress(line) {
  // [download]  45.3% of  100.00MiB at  2.05MiB/s ETA 00:24
  const match = line.match(/\[download\]\s+([\d.]+)%\s+of\s+([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)(?:\s+ETA\s+([\d:]+))?/);
  if (match) {
    return {
      percent: parseFloat(match[1]),
      filesize: match[2].trim(),
      speed: match[3].trim(),
      eta: match[4] ? match[4].trim() : null
    };
  }

  // [download] Destination: /path/to/file.mp4
  const destMatch = line.match(/\[download\]\s+Destination:\s+(.+)/);
  if (destMatch) return { destination: destMatch[1].trim() };

  // [download] 100% of 100.00MiB in 00:45 at 2.21MiB/s
  const doneMatch = line.match(/\[download\]\s+100%\s+of\s+([\d.]+\s*\w+)/);
  if (doneMatch) return { percent: 100, filesize: doneMatch[1].trim(), done: true };

  return null;
}

// 执行下载
function downloadUrl(options, onProgress, onLog) {
  const { url, outputDir, format, quality } = options;

  return new Promise(async (resolve, reject) => {
    const status = await getYtdlpStatus();
    if (!status.installed) {
      resolve({ success: false, error: 'yt-dlp 未安装，请先点击安装' });
      return;
    }

    const ytdlpPath = status.path;

    // 输出模板：保留原始文件名
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    // 构建参数
    const args = [
      url,
      '-o', outputTemplate,
      '--no-playlist',
      '--progress',
      '--newline',   // 每行输出进度（便于解析）
    ];

    // 格式/质量选择
    if (format === 'audio') {
      args.push('-x', '--audio-format', quality || 'mp3');
    } else {
      // 视频：优先选择最佳 mp4，其次最佳
      const fmtStr = quality === 'best'
        ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'
        : quality === '1080p'
          ? 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]'
          : quality === '720p'
            ? 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]'
            : quality === '480p'
              ? 'best[height<=480]'
              : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
      args.push('-f', fmtStr);
      // 合并输出为 mp4
      args.push('--merge-output-format', 'mp4');
    }

    // 传入 ffmpeg 路径，让 yt-dlp 能合并 video+audio 为单个文件
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    if (onLog) onLog({ type: 'start', message: `开始下载: ${url}` });
    if (onLog) onLog({ type: 'info', message: `yt-dlp 参数: ${args.join(' ')}` });
    if (onLog && ffmpegPath) onLog({ type: 'info', message: `ffmpeg: ${ffmpegPath}` });

    let finalFilePath = null;

    currentDownloadProc = spawn(ytdlpPath, args, { cwd: outputDir });

    currentDownloadProc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        if (onLog) onLog({ type: 'progress', message: line.trim() });

        const prog = parseProgress(line);
        if (prog) {
          if (prog.destination) finalFilePath = prog.destination;
          if (prog.percent !== undefined && onProgress) {
            onProgress({
              percent: prog.percent,
              speed: prog.speed || '',
              eta: prog.eta || '',
              filesize: prog.filesize || ''
            });
          }
        }
      }
    });

    currentDownloadProc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line && onLog) onLog({ type: 'info', message: line });
    });

    currentDownloadProc.on('close', async (code) => {
      currentDownloadProc = null;
      if (code === 0) {
        // 尝试找到实际下载的文件
        if (!finalFilePath) {
          finalFilePath = await findDownloadedFile(outputDir);
        }
        if (onLog) onLog({ type: 'success', message: `下载完成${finalFilePath ? ': ' + path.basename(finalFilePath) : ''}` });
        resolve({ success: true, filePath: finalFilePath });
      } else if (code === null) {
        // 被取消
        resolve({ success: false, cancelled: true, error: '下载已取消' });
      } else {
        const err = `yt-dlp 退出码: ${code}`;
        if (onLog) onLog({ type: 'error', message: err });
        resolve({ success: false, error: err });
      }
    });

    currentDownloadProc.on('error', (err) => {
      currentDownloadProc = null;
      if (onLog) onLog({ type: 'error', message: `执行错误: ${err.message}` });
      resolve({ success: false, error: err.message });
    });
  });
}

// 取消当前下载
function cancelDownload() {
  if (currentDownloadProc) {
    currentDownloadProc.kill('SIGTERM');
    currentDownloadProc = null;
  }
}

// 找到最近修改的媒体文件（下载完成后回填路径）
async function findDownloadedFile(dir) {
  try {
    const videoExts = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.mp3', '.m4a', '.flac', '.wav', '.opus'];
    const files = fs.readdirSync(dir)
      .map(f => ({ name: f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter(f => videoExts.includes(path.extname(f.name).toLowerCase()))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].full : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  getYtdlpStatus,
  installYtdlp,
  downloadUrl,
  cancelDownload,
  getYtdlpPath,
  getYtdlpDir
};
