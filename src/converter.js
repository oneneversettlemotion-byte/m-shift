'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

// Set ffmpeg path
// In packaged Electron (asar), module paths point inside app.asar which is a file, not a dir.
// We must remap to app.asar.unpacked where the binary actually lives.
function resolveUnpacked(p) {
  if (!p) return p;
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
}

let ffmpegPath;
try {
  const rawPath = require('ffmpeg-static');
  ffmpegPath = resolveUnpacked(rawPath);
  console.log('[converter] ffmpeg path:', ffmpegPath);
  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  }
} catch (e) {
  try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    ffmpegPath = resolveUnpacked(ffmpegInstaller.path);
    ffmpeg.setFfmpegPath(ffmpegPath);
  } catch (e2) {
    console.error('Could not find ffmpeg:', e2);
  }
}

// Supported format definitions
const FORMATS = {
  video: [
    { ext: 'mp4',  label: 'MP4 (H.264)',       codec: 'libx264',    container: 'mp4'  },
    { ext: 'mp4',  label: 'MP4 (H.265/HEVC)',   codec: 'libx265',    container: 'mp4'  },
    { ext: 'webm', label: 'WebM (VP9)',          codec: 'libvpx-vp9', container: 'webm' },
    { ext: 'webm', label: 'WebM (VP8)',          codec: 'libvpx',     container: 'webm' },
    { ext: 'mov',  label: 'MOV (ProRes 422)',    codec: 'prores',     container: 'mov'  },
    { ext: 'mov',  label: 'MOV (ProRes 4444)',   codec: 'prores_ks',  container: 'mov'  },
    { ext: 'avi',  label: 'AVI (DivX)',          codec: 'mpeg4',      container: 'avi'  },
    { ext: 'mkv',  label: 'MKV (H.264)',         codec: 'libx264',    container: 'matroska' },
    { ext: 'mkv',  label: 'MKV (H.265)',         codec: 'libx265',    container: 'matroska' },
    { ext: 'flv',  label: 'FLV (Flash)',         codec: 'flv',        container: 'flv'  },
    { ext: 'ts',   label: 'MPEG-TS',             codec: 'mpeg2video', container: 'mpegts' },
    { ext: 'mpg',  label: 'MPEG-2 Video',        codec: 'mpeg2video', container: 'mpeg' },
    { ext: 'm4v',  label: 'M4V (iTunes)',        codec: 'libx264',    container: 'mp4'  },
    { ext: 'gif',  label: 'Animated GIF',        codec: 'gif',        container: 'gif'  },
    { ext: 'apng', label: 'Animated PNG',        codec: 'apng',       container: 'apng' },
    { ext: 'mxf',  label: 'MXF (XDCAM)',        codec: 'mpeg2video', container: 'mxf'  },
    { ext: 'dnxhd',label: 'DNxHD (Avid)',        codec: 'dnxhd',      container: 'mov'  },
  ],
  image: [
    { ext: 'jpg',  label: 'JPEG',               codec: 'mjpeg'   },
    { ext: 'png',  label: 'PNG (Lossless)',      codec: 'png'     },
    { ext: 'webp', label: 'WebP',               codec: 'libwebp' },
    { ext: 'tiff', label: 'TIFF',               codec: 'tiff'    },
    { ext: 'bmp',  label: 'BMP',                codec: 'bmp'     },
    { ext: 'tga',  label: 'TGA',                codec: 'targa'   },
    { ext: 'dpx',  label: 'DPX (Cinema)',       codec: 'dpx'     },
    { ext: 'exr',  label: 'OpenEXR (HDR)',      codec: 'exr'     },
    { ext: 'hdr',  label: 'Radiance HDR',       codec: 'hdr'     },
    { ext: 'ppm',  label: 'PPM (Raw)',           codec: 'ppm'     },
    { ext: 'pgm',  label: 'PGM (Grayscale)',    codec: 'pgm'     },
    { ext: 'ico',  label: 'ICO (Windows Icon)', codec: 'bmp'     },
    { ext: 'icns', label: 'ICNS (macOS Icon)',  codec: '_icns'   },
    { ext: 'avif', label: 'AVIF (AV1)',          codec: 'libaom-av1' },
    { ext: 'jxl',  label: 'JPEG XL',            codec: 'libjxl'  },
  ],
  audio: [
    { ext: 'mp3',  label: 'MP3',                codec: 'libmp3lame' },
    { ext: 'aac',  label: 'AAC',                codec: 'aac'       },
    { ext: 'wav',  label: 'WAV (PCM)',           codec: 'pcm_s16le' },
    { ext: 'flac', label: 'FLAC (Lossless)',     codec: 'flac'      },
    { ext: 'ogg',  label: 'OGG Vorbis',         codec: 'libvorbis' },
    { ext: 'opus', label: 'Opus',               codec: 'libopus'   },
    { ext: 'm4a',  label: 'M4A (AAC)',           codec: 'aac'       },
    { ext: 'aiff', label: 'AIFF',               codec: 'pcm_s16be' },
  ]
};

// Detect file type from extension
function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const videoExts = ['mp4','mov','avi','mkv','flv','wmv','webm','mpg','mpeg','m4v','ts','mts','m2ts','3gp','ogv','rm','rmvb','vob','mxf'];
  const imageExts = ['jpg','jpeg','png','gif','bmp','tiff','tif','webp','tga','dpx','exr','hdr','ppm','pgm','ico','avif','jxl','heic','heif'];
  const audioExts = ['mp3','aac','wav','flac','ogg','opus','m4a','aiff','wma','ac3'];

  if (videoExts.includes(ext)) return 'video';
  if (imageExts.includes(ext)) return 'image';
  if (audioExts.includes(ext)) return 'audio';
  return 'unknown';
}

// Detect if folder contains image sequence
function detectImageSequence(files) {
  if (!files || files.length < 2) return null;
  const imageFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.jpg','.jpeg','.png','.tiff','.tif','.tga','.dpx','.exr','.bmp'].includes(ext);
  }).sort();
  
  if (imageFiles.length < 2) return null;
  
  // Check if filenames have numeric sequences
  const baseName = path.basename(imageFiles[0]);
  const numMatch = baseName.match(/(\d+)\.[^.]+$/);
  if (!numMatch) return null;
  
  return {
    isSequence: true,
    files: imageFiles,
    count: imageFiles.length,
    ext: path.extname(imageFiles[0]).toLowerCase().replace('.', '')
  };
}

// Get probe info
function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata);
    });
  });
}

// Main conversion function
function convert(options, onProgress, onLog) {
  // ICNS 需要走单独的路径
  if (options.format && options.format.ext === 'icns') {
    return convertToIcns(options, onProgress, onLog);
  }
  return convertFFmpeg(options, onProgress, onLog);
}

// ICNS 转换：用 ffmpeg 生成多尺寸 PNG → iconutil 打包
const { execFile } = require('child_process');
const os = require('os');

async function convertToIcns(options, onProgress, onLog) {
  const { inputFiles, outputPath } = options;
  const inputFile = inputFiles[0];
  const tmpDir = path.join(os.tmpdir(), `icns_${Date.now()}`);
  const iconsetDir = tmpDir + '/icon.iconset';

  fs.mkdirSync(iconsetDir, { recursive: true });

  // macOS iconset 规定的尺寸
  const sizes = [
    { size: 16,   name: 'icon_16x16.png' },
    { size: 32,   name: 'icon_16x16@2x.png' },
    { size: 32,   name: 'icon_32x32.png' },
    { size: 64,   name: 'icon_32x32@2x.png' },
    { size: 128,  name: 'icon_128x128.png' },
    { size: 256,  name: 'icon_128x128@2x.png' },
    { size: 256,  name: 'icon_256x256.png' },
    { size: 512,  name: 'icon_256x256@2x.png' },
    { size: 512,  name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];

  if (onLog) onLog({ type: 'start', message: `生成 ICNS：${path.basename(inputFile)} → ${path.basename(outputPath)}` });

  // 依次生成各尺寸 PNG
  const total = sizes.length;
  for (let i = 0; i < sizes.length; i++) {
    const { size, name } = sizes[i];
    const outPng = path.join(iconsetDir, name);
    await new Promise((resolve, reject) => {
      ffmpeg(inputFile)
        .size(`${size}x${size}`)
        .videoCodec('png')
        .frames(1)
        .on('end', resolve)
        .on('error', reject)
        .save(outPng);
    });
    const pct = Math.round(((i + 1) / (total + 1)) * 90);
    if (onProgress) onProgress({ percent: pct, timemark: '' });
  }

  if (onLog) onLog({ type: 'progress', message: `所有尺寸生成完毕，正在用 iconutil 打包...` });

  // 用 iconutil 打包成 .icns
  const icnsOut = outputPath.endsWith('.icns') ? outputPath : outputPath + '.icns';
  await new Promise((resolve, reject) => {
    execFile('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsOut], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });

  // 清理临时目录
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}

  if (onProgress) onProgress({ percent: 100, timemark: '' });
  if (onLog) onLog({ type: 'end', message: 'ICNS 生成完成！' });
  return icnsOut;
}

// 原 ffmpeg 转换逻辑（改名）
function convertFFmpeg(options, onProgress, onLog) {
  return new Promise((resolve, reject) => {
    const {
      inputFiles,       // array of file paths
      outputPath,       // output file path
      format,           // format object {ext, label, codec, container}
      settings,         // {quality, fps, width, height, audioCodec, audioBitrate, videoFilter}
      isSequence,       // boolean
      sequencePattern,  // pattern like /path/to/frame%04d.png
      fps               // input fps for sequence
    } = options;

    let cmd = ffmpeg();

    // Input handling
    if (isSequence && sequencePattern) {
      cmd = cmd.input(sequencePattern)
                .inputOptions([`-framerate ${fps || 24}`]);
    } else if (inputFiles.length === 1) {
      cmd = cmd.input(inputFiles[0]);
    } else {
      // Concat multiple files
      inputFiles.forEach(f => cmd.input(f));
    }

    // Output codec
    const AUDIO_EXTS = new Set(['mp3','aac','wav','flac','ogg','opus','m4a','aiff']);
    const isAudioOutput = AUDIO_EXTS.has(String(format.ext).toLowerCase());
    if (format.codec) {
      if (isAudioOutput) {
        cmd = cmd.audioCodec(format.codec);
        // 音频输出默认去掉视频流，避免某些容器里残留封面图导致报错
        cmd = cmd.noVideo();
      } else {
        cmd = cmd.videoCodec(format.codec);
      }
    }

    // Quality settings
    if (settings) {
      if (settings.quality !== undefined) {
        const q = parseInt(settings.quality);
        if (format.codec === 'libx264' || format.codec === 'libx265') {
          // CRF: 0=lossless, 51=worst (18-28 typical)
          const crf = Math.round(51 - (q / 100) * 51);
          cmd = cmd.outputOptions([`-crf ${Math.max(0, Math.min(51, crf))}`]);
        } else if (format.codec === 'libvpx-vp9' || format.codec === 'libvpx') {
          const crf = Math.round(63 - (q / 100) * 63);
          cmd = cmd.outputOptions([`-crf ${crf}`, '-b:v 0']);
        } else if (format.codec === 'mjpeg' || format.codec === 'png') {
          const qv = Math.round(2 + (1 - q / 100) * 29);
          cmd = cmd.outputOptions([`-q:v ${qv}`]);
        }
      }
      
      if (settings.fps && !isSequence) {
        cmd = cmd.fps(parseFloat(settings.fps));
      }
      
      if (settings.width && settings.height) {
        cmd = cmd.size(`${settings.width}x${settings.height}`);
      } else if (settings.width) {
        cmd = cmd.size(`${settings.width}x?`);
      } else if (settings.height) {
        cmd = cmd.size(`?x${settings.height}`);
      }

      if (settings.audioCodec) {
        cmd = cmd.audioCodec(settings.audioCodec);
      }
      if (settings.audioBitrate) {
        cmd = cmd.audioBitrate(settings.audioBitrate);
      }
      if (settings.noAudio) {
        cmd = cmd.noAudio();
      }
    }

    // Format-specific options
    if (format.container) {
      cmd = cmd.format(format.container);
    }
    
    // ProRes specifics
    if (format.codec === 'prores_ks') {
      cmd = cmd.outputOptions(['-profile:v 4444', '-pix_fmt yuva444p10le']);
    } else if (format.codec === 'prores') {
      cmd = cmd.outputOptions(['-profile:v 2', '-pix_fmt yuv422p10le']);
    }

    // GIF optimizations
    if (format.ext === 'gif') {
      const vf = 'split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer';
      cmd = cmd.complexFilter(vf);
      // GIF 循环：-loop 0=无限, -loop N=次数
      const loopCount = (settings && settings.loopCount !== undefined) ? settings.loopCount : 0;
      cmd = cmd.outputOptions([`-loop ${loopCount}`]);
    }

    // WebP / APNG loop
    if (format.ext === 'webp' || format.ext === 'apng') {
      const loopCount = (settings && settings.loopCount !== undefined) ? settings.loopCount : 0;
      cmd = cmd.outputOptions([`-loop ${loopCount}`]);
    }

    // Event handlers
    cmd.on('start', (cmdLine) => {
      if (onLog) onLog({ type: 'start', message: `Starting: ${cmdLine}` });
    });

    cmd.on('progress', (progress) => {
      if (onProgress) onProgress({ percent: progress.percent || 0, timemark: progress.timemark || '' });
      if (onLog) onLog({ type: 'progress', message: `Processing: ${Math.round(progress.percent || 0)}% - ${progress.timemark || ''}` });
    });

    cmd.on('end', () => {
      if (onLog) onLog({ type: 'end', message: 'Conversion completed!' });
      resolve(outputPath);
    });

    cmd.on('error', (err) => {
      if (onLog) onLog({ type: 'error', message: `Error: ${err.message}` });
      reject(err);
    });

    cmd.save(outputPath);
  });
}

// Extract image sequence pattern from sorted file list
function buildSequencePattern(files) {
  if (!files || files.length === 0) return null;
  const sorted = [...files].sort();
  const first = sorted[0];
  const dir = path.dirname(first);
  const ext = path.extname(first);
  const base = path.basename(first, ext);
  
  // Find numeric part at end
  const match = base.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  
  const prefix = match[1];
  const numStr = match[2];
  const padLen = numStr.length;
  
  return path.join(dir, `${prefix}%0${padLen}d${ext}`);
}

module.exports = {
  FORMATS,
  detectFileType,
  detectImageSequence,
  probeFile,
  convert,
  buildSequencePattern
};
