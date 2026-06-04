'use strict';

/**
 * 加密音乐解密模块
 * 当前支持：
 *   - .ncm（网易云音乐）：纯 Node 实现
 * 计划支持：
 *   - .qmc* / .mflac / .mgg（QQ音乐）
 *   - .kgm / .kgma / .vpr（酷狗）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 加密扩展名
const ENCRYPTED_EXTS = new Set([
  'ncm',
  // QQ 音乐（暂未实现，占位）
  'qmc0', 'qmc3', 'qmcflac', 'qmcogg', 'mflac', 'mgg', 'mgg1', 'mflac0',
  'bkcmp3', 'bkcflac',
  // 酷狗（暂未实现，占位）
  'kgm', 'kgma', 'vpr',
  // 酷我（暂未实现，占位）
  'kwm',
]);

function isEncryptedAudio(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return ENCRYPTED_EXTS.has(ext);
}

// ====== NCM 解密 ======
// 算法参考：https://github.com/anonymous5l/ncmdump (公开，2018)
const NCM_CORE_KEY  = Buffer.from('687A4852416D736F356B496E62617857', 'hex'); // hardcoded
const NCM_META_KEY  = Buffer.from('2331346C6A6B5F215C5D2630553C2728', 'hex'); // hardcoded

function aesEcbDecrypt(key, data) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function decryptNcm(inputPath, outputDir) {
  const buf = fs.readFileSync(inputPath);
  let off = 0;

  // 1. magic
  const magic = buf.slice(0, 8).toString('ascii');
  if (magic !== 'CTENFDAM') throw new Error('不是有效的 NCM 文件');
  off = 10; // 8 magic + 2 unknown

  // 2. RC4 key
  const keyLen = buf.readUInt32LE(off); off += 4;
  const keyData = Buffer.from(buf.slice(off, off + keyLen)); off += keyLen;
  for (let i = 0; i < keyData.length; i++) keyData[i] ^= 0x64;
  const keyDec = aesEcbDecrypt(NCM_CORE_KEY, keyData);
  // 去掉前 17 字节 "neteasecloudmusic"
  const rc4Key = keyDec.slice(17);

  // 3. 构建 keyBox（RC4-like KSA）
  const keyBox = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) keyBox[i] = i;
  let lastByte = 0, keyOff = 0;
  for (let i = 0; i < 256; i++) {
    const swap = keyBox[i];
    const c = (swap + lastByte + rc4Key[keyOff]) & 0xff;
    keyBox[i] = keyBox[c];
    keyBox[c] = swap;
    lastByte = c;
    keyOff = (keyOff + 1) % rc4Key.length;
  }

  // 4. metadata
  const metaLen = buf.readUInt32LE(off); off += 4;
  let title = path.basename(inputPath, path.extname(inputPath));
  let artist = '';
  let album = '';
  let format = null;
  if (metaLen > 0) {
    const metaData = Buffer.from(buf.slice(off, off + metaLen)); off += metaLen;
    for (let i = 0; i < metaData.length; i++) metaData[i] ^= 0x63;
    // 去掉前 22 字节 "163 key(Don't modify):"
    const metaB64 = metaData.slice(22).toString('ascii');
    try {
      const metaJsonBuf = aesEcbDecrypt(NCM_META_KEY, Buffer.from(metaB64, 'base64'));
      // 去掉前 6 字节 "music:"
      const metaJson = JSON.parse(metaJsonBuf.slice(6).toString('utf8'));
      if (metaJson.musicName) title = String(metaJson.musicName);
      if (metaJson.artist) {
        artist = Array.isArray(metaJson.artist)
          ? metaJson.artist.map(a => Array.isArray(a) ? a[0] : a).join(', ')
          : String(metaJson.artist);
      }
      if (metaJson.album) album = String(metaJson.album);
      if (metaJson.format) format = String(metaJson.format).toLowerCase();
    } catch (e) {
      // 元数据解析失败不影响解密，继续
    }
  } else {
    off += metaLen;
  }

  // 5. CRC + gap
  off += 9; // 4 CRC + 5 gap

  // 6. 跳过封面
  const imgLen = buf.readUInt32LE(off); off += 4;
  off += imgLen;

  // 7. 解密音频数据
  const audio = Buffer.from(buf.slice(off));
  for (let i = 0; i < audio.length; i++) {
    const j = (i + 1) & 0xff;
    audio[i] ^= keyBox[(keyBox[j] + keyBox[(keyBox[j] + j) & 0xff]) & 0xff];
  }

  // 8. 嗅探格式
  if (!format) {
    if (audio.length >= 4 && audio.slice(0, 4).toString('ascii') === 'fLaC') format = 'flac';
    else if (audio.length >= 3 && audio.slice(0, 3).toString('ascii') === 'ID3') format = 'mp3';
    else if (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) format = 'mp3';
    else format = 'mp3';
  }

  // 9. 输出文件名
  let safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!safeTitle) safeTitle = path.basename(inputPath, path.extname(inputPath));
  const baseName = artist ? `${safeTitle} - ${artist}` : safeTitle;
  let outputPath = path.join(outputDir, `${baseName}.${format}`);
  let n = 1;
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(outputDir, `${baseName} (${n}).${format}`);
    n++;
  }

  fs.writeFileSync(outputPath, audio);
  return { outputPath, format, title: safeTitle, artist, album };
}

/**
 * 统一解密入口
 * @param {string} inputPath 输入文件路径
 * @param {string} outputDir 输出目录
 * @returns {Promise<{ok:boolean, outputPath?:string, format?:string, error?:string}>}
 */
async function decryptToFile(inputPath, outputDir) {
  try {
    if (!fs.existsSync(inputPath)) {
      return { ok: false, error: '文件不存在' };
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const ext = path.extname(inputPath).toLowerCase().replace('.', '');

    if (ext === 'ncm') {
      const r = decryptNcm(inputPath, outputDir);
      return { ok: true, ...r };
    }

    // 其他格式暂未实现
    return {
      ok: false,
      error: `暂不支持 .${ext} 格式（目前仅支持 .ncm，QQ音乐/酷狗后续添加）`,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = {
  isEncryptedAudio,
  decryptToFile,
  ENCRYPTED_EXTS: Array.from(ENCRYPTED_EXTS),
};
