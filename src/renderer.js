'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  files: [],
  activeFileIdx: -1,
  formats: {},
  selectedCategory: 'video',
  selectedFormat: null,
  outputDir: null,
  isConverting: false,
  currentDuration: 0   // 当前转换文件的时长（秒），用于进度计算
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Init（等 DOM ready）──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  state.formats = await window.api.getFormats();
  renderFormatGrid('video');
  setupEventListeners();
  setupIPC();
  addLog('M-SHIFT 已就绪。', 'info');
});

// ── Format Grid ───────────────────────────────────────────────────────────────
function renderFormatGrid(category) {
  state.selectedCategory = category;
  state.selectedFormat = null;
  const formatGrid = $('format-grid');

  // 同步 data-cat 到 #app（全局高亮色联动）和 #middle-panel
  const appEl = document.getElementById('app');
  const midPanel = document.getElementById('middle-panel');
  if (appEl) appEl.dataset.cat = category;
  if (midPanel) midPanel.dataset.cat = category;

  const formats = state.formats[category] || [];

  // 用 DocumentFragment 批量构建后一次性替换，避免先清空再插入导致高度塌陷跳动
  const fragment = document.createDocumentFragment();
  formats.forEach((fmt) => {
    const card = document.createElement('div');
    card.className = `format-card cat-${category}`;
    card.innerHTML = `
      <div class="fc-ext">${fmt.ext}</div>
      <div class="fc-label">${fmt.label}</div>
    `;
    card.addEventListener('click', () => selectFormat(fmt, card));
    fragment.appendChild(card);
  });

  // 一次性替换，不会出现中间空白帧
  formatGrid.replaceChildren(fragment);

  // 整体淡入
  formatGrid.style.opacity = '0';
  requestAnimationFrame(() => {
    formatGrid.style.transition = 'opacity 0.15s ease';
    formatGrid.style.opacity = '1';
  });

  if (formats.length > 0) {
    selectFormat(formats[0], formatGrid.firstElementChild);
  }

  updateSettingsVisibility(category);
}

function selectFormat(fmt, cardEl) {
  state.selectedFormat = fmt;
  $('format-grid').querySelectorAll('.format-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  // WebP 和 GIF 支持循环设置
  const loopWrap = $('loop-count-wrap');
  if (loopWrap) {
    const ext = fmt.ext?.toLowerCase();
    loopWrap.style.display = (ext === 'webp' || ext === 'gif' || ext === 'apng') ? '' : 'none';
  }
  validateConvert();
}

function updateSettingsVisibility(category) {
  $('sg-video').style.display  = category === 'video'  ? '' : 'none';
  $('sg-image').style.display  = category === 'image'  ? '' : 'none';
  $('sg-audio').style.display  = category === 'audio'  ? '' : 'none';
  updateSequenceSettings();
}

function updateSequenceSettings() {
  const hasSeq = state.files.some(f => f.isSequence);
  $('sg-sequence').style.display = hasSeq ? '' : 'none';
}

// ── File Management ───────────────────────────────────────────────────────────
async function addFiles(filePaths) {
  if (!filePaths || filePaths.length === 0) return;

  // 添加新文件时重置进度和结果区
  resetProgressAndResults();

  if (filePaths.length >= 2) {
    const seqInfo = await window.api.detectSequence(filePaths);
    if (seqInfo && seqInfo.isSequence) {
      await addSequenceGroup(filePaths, seqInfo);
      return;
    }
  }

  for (const fp of filePaths) {
    await addSingleFile(fp);
  }
  renderFileList();
  validateConvert();
}

async function addSingleFile(fp) {
  const name = fp.split('/').pop();
  const type = await window.api.detectFileType(fp);

  const fileObj = {
    id: Date.now() + Math.random(),
    path: fp,
    name,
    type,
    meta: null,
    isSequence: false
  };

  state.files.push(fileObj);
  probeAndUpdate(fileObj);
}

async function addSequenceGroup(files, seqInfo) {
  const sorted = [...files].sort();
  const firstName = sorted[0].split('/').pop();
  const name = firstName.replace(/\d+(\.[^.]+)$/, '***$1');

  const fileObj = {
    id: Date.now() + Math.random(),
    path: sorted[0],
    paths: sorted,
    name: `[序列] ${name}`,
    type: 'sequence',
    meta: null,
    isSequence: true,
    seqInfo
  };
  state.files.push(fileObj);
  renderFileList();
  validateConvert();
  addLog(`检测到图片序列: ${seqInfo.count} 帧 (${seqInfo.ext})`, 'info');
}

async function addFolderFiles(folderData) {
  if (!folderData) return;
  const { files } = folderData;
  const seqInfo = await window.api.detectSequence(files);

  if (seqInfo && seqInfo.isSequence) {
    await addSequenceGroup(files, seqInfo);
    showToast(`检测到图片序列: ${seqInfo.count} 帧`, 'success');
  } else {
    await addFiles(files);
    showToast(`已添加 ${files.length} 个文件`, 'info');
  }
}

async function probeAndUpdate(fileObj) {
  try {
    const result = await window.api.probeFile(fileObj.path);
    if (result.success) {
      fileObj.meta = result.data;
      if (state.activeFileIdx >= 0 && state.files[state.activeFileIdx]?.id === fileObj.id) {
        renderMetadata(fileObj);
      }
    }
  } catch (e) {/* silent */}
}

function removeFile(idx) {
  state.files.splice(idx, 1);
  if (state.activeFileIdx >= state.files.length) {
    state.activeFileIdx = state.files.length - 1;
  }
  renderFileList();
  if (state.activeFileIdx >= 0) {
    selectFile(state.activeFileIdx);
  } else {
    clearPreview();
    clearMetadata();
  }
  validateConvert();
}

function clearAllFiles() {
  state.files = [];
  state.activeFileIdx = -1;
  renderFileList();
  clearPreview();
  clearMetadata();
  resetProgressAndResults();
  validateConvert();
}

function resetProgressAndResults() {
  const rightProgressWrap = $('right-progress-bar-wrap');
  const rightResultsList  = $('right-results-list');
  const rightPlaceholder  = $('right-progress-placeholder');
  const rightProgressFill = $('right-progress-fill');
  const rightProgressPct  = $('right-progress-pct');
  const rightProgressLabel= $('right-progress-label');
  if (rightProgressWrap) rightProgressWrap.style.display = 'none';
  if (rightResultsList)  rightResultsList.innerHTML = '';
  if (rightPlaceholder)  rightPlaceholder.style.display = '';
  if (rightProgressFill) rightProgressFill.style.width = '0%';
  if (rightProgressPct)  rightProgressPct.textContent = '0%';
  if (rightProgressLabel) rightProgressLabel.textContent = '等待中...';
  state.currentDuration = 0;
}

// ── File List Render ──────────────────────────────────────────────────────────
function renderFileList() {
  const fileList  = $('file-list');
  const queueCount = $('queue-count');
  const btnClearAll = $('btn-clear-all');
  const count = state.files.length;

  queueCount.textContent = count > 0 ? `(${count})` : '';
  btnClearAll.style.display = count > 0 ? '' : 'none';

  if (count === 0) {
    fileList.innerHTML = `
      <div class="empty-state">
        <div class="es-icon"><svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="1" y="3" width="38" height="34" rx="7" fill="#1e1e1e"/><rect x="7" y="1" width="8" height="6" rx="2" fill="#2e2e2e"/><rect x="25" y="1" width="8" height="6" rx="2" fill="#2e2e2e"/><rect x="1" y="3" width="38" height="34" rx="7" stroke="rgba(255,255,255,0.08)" stroke-width="1"/><path d="M15 14 L28 20 L15 26 Z" fill="rgba(244,132,95,0.7)"/><rect x="6" y="31" width="28" height="2.5" rx="1.25" fill="#2e2e2e"/><rect x="6" y="31" width="14" height="2.5" rx="1.25" fill="rgba(244,132,95,0.5)"/></svg></div>
        <div class="es-text">暂无文件，请添加</div>
      </div>`;
    return;
  }

  fileList.innerHTML = '';
  state.files.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = `file-item fade-in${i === state.activeFileIdx ? ' active' : ''}`;
    const icon = getFileIcon(f.type);
    const iconClass = f.type === 'sequence' ? 'sequence' : f.type;
    div.innerHTML = `
      <div class="fi-icon ${iconClass}">${icon}</div>
      <div class="fi-info">
        <div class="fi-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="fi-meta">${getFileMeta(f)}</div>
      </div>
      <div class="fi-remove" data-idx="${i}" title="移除">✕</div>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('fi-remove')) return;
      selectFile(i);
    });
    div.querySelector('.fi-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(e.target.dataset.idx));
    });
    fileList.appendChild(div);
  });

  updateSequenceSettings();
}

function getFileIcon(type) {
  const svgs = {
    video: `<svg width="16" height="16" viewBox="0 0 40 40" fill="none">
      <rect x="1" y="3" width="38" height="34" rx="7" fill="rgba(244,132,95,0.15)"/>
      <rect x="1" y="3" width="38" height="34" rx="7" stroke="rgba(244,132,95,0.3)" stroke-width="1.5" fill="none"/>
      <path d="M15 13 L28 20 L15 27 Z" fill="rgba(244,132,95,0.85)"/>
    </svg>`,
    image: `<svg width="16" height="16" viewBox="0 0 40 40" fill="none">
      <rect x="2" y="5" width="36" height="30" rx="6" fill="rgba(126,200,227,0.15)" stroke="rgba(126,200,227,0.3)" stroke-width="1.5"/>
      <circle cx="12" cy="15" r="4" fill="rgba(126,200,227,0.7)"/>
      <path d="M5 31 L13 21 L20 28 L27 19 L35 31" stroke="rgba(126,200,227,0.7)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    audio: `<svg width="16" height="16" viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="17" fill="rgba(230,63,106,0.12)" stroke="rgba(230,63,106,0.3)" stroke-width="1.5"/>
      <path d="M14 14 L14 26 M20 10 L20 30 M26 14 L26 26" stroke="rgba(230,63,106,0.8)" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,
    sequence: `<svg width="16" height="16" viewBox="0 0 40 40" fill="none">
      <rect x="2" y="8" width="36" height="24" rx="5" fill="rgba(244,132,95,0.1)" stroke="rgba(244,132,95,0.3)" stroke-width="1.5"/>
      <line x1="10" y1="8" x2="10" y2="32" stroke="rgba(244,132,95,0.4)" stroke-width="1.5"/>
      <line x1="20" y1="8" x2="20" y2="32" stroke="rgba(244,132,95,0.4)" stroke-width="1.5"/>
      <line x1="30" y1="8" x2="30" y2="32" stroke="rgba(244,132,95,0.4)" stroke-width="1.5"/>
      <rect x="5" y="2" width="4" height="8" rx="1.5" fill="rgba(244,132,95,0.6)"/>
      <rect x="15" y="2" width="4" height="8" rx="1.5" fill="rgba(244,132,95,0.6)"/>
      <rect x="25" y="2" width="4" height="8" rx="1.5" fill="rgba(244,132,95,0.6)"/>
    </svg>`,
    unknown: `<svg width="16" height="16" viewBox="0 0 40 40" fill="none">
      <rect x="8" y="2" width="24" height="30" rx="5" fill="rgba(168,168,168,0.12)" stroke="rgba(168,168,168,0.25)" stroke-width="1.5"/>
      <path d="M22 2 L32 12 L22 12 Z" fill="rgba(168,168,168,0.15)" stroke="rgba(168,168,168,0.2)" stroke-width="1"/>
      <line x1="13" y1="19" x2="27" y2="19" stroke="rgba(168,168,168,0.5)" stroke-width="2" stroke-linecap="round"/>
      <line x1="13" y1="24" x2="22" y2="24" stroke="rgba(168,168,168,0.35)" stroke-width="2" stroke-linecap="round"/>
    </svg>`
  };
  return svgs[type] || svgs.unknown;
}

function getFileMeta(f) {
  if (f.isSequence) return `${f.seqInfo.count} 帧 · ${f.seqInfo.ext.toUpperCase()}`;
  const ext = f.path.split('.').pop().toUpperCase();
  if (f.meta) {
    const vs = f.meta.streams?.find(s => s.codec_type === 'video');
    if (vs) {
      try {
        const fps = vs.r_frame_rate ? Math.round(eval(vs.r_frame_rate)) : '';
        const res = vs.width ? `${vs.width}×${vs.height}` : '';
        return [res, fps && `${fps}fps`, ext].filter(Boolean).join(' · ');
      } catch(e) {}
    }
  }
  return ext;
}

function selectFile(idx) {
  state.activeFileIdx = idx;
  renderFileList();
  const f = state.files[idx];
  if (!f) return;
  const base = f.name
    .replace(/\.[^.]+$/, '')
    .replace(/\[序列\]\s*/, '')
    .replace(/\*+/g, '')
    .replace(/\.$/, '')
    .trim() || 'output';
  $('output-name').value = base + '_converted';
}

// ── Preview ───────────────────────────────────────────────────────────────────
function loadPreview(f) {
  const img   = $('preview-img');
  const video = $('preview-video');
  const ph    = $('preview-placeholder');

  img.style.display   = 'none';
  video.style.display = 'none';
  ph.style.display    = '';

  if (f.type === 'image' || (f.type === 'sequence' && f.path)) {
    img.src = `file://${f.path}`;
    img.style.display = '';
    ph.style.display  = 'none';
  } else if (f.type === 'video') {
    video.src = `file://${f.path}`;
    video.style.display = '';
    ph.style.display    = 'none';
  }
}

function clearPreview() {
  $('preview-img').style.display   = 'none';
  $('preview-video').style.display = 'none';
  $('preview-placeholder').style.display = '';
}

// ── Metadata ──────────────────────────────────────────────────────────────────
function renderMetadata(f) {
  const area = $('metadata-area');
  if (!f.meta) { area.innerHTML = ''; return; }

  const rows = [];
  const vs = f.meta.streams?.find(s => s.codec_type === 'video');
  const as = f.meta.streams?.find(s => s.codec_type === 'audio');
  const fmt = f.meta.format;

  if (vs) {
    rows.push(['编码', vs.codec_name?.toUpperCase()]);
    if (vs.width) rows.push(['分辨率', `${vs.width} × ${vs.height}`]);
    if (vs.r_frame_rate) {
      try { rows.push(['帧率', `${eval(vs.r_frame_rate).toFixed(2)} fps`]); } catch(e){}
    }
    if (vs.pix_fmt) rows.push(['像素格式', vs.pix_fmt]);
  }
  if (as) {
    rows.push(['音频', `${as.codec_name?.toUpperCase()} ${as.sample_rate}Hz`]);
  }
  if (fmt?.duration) {
    const dur = parseFloat(fmt.duration);
    const m = Math.floor(dur / 60), s = Math.floor(dur % 60);
    rows.push(['时长', `${m}:${String(s).padStart(2,'0')}`]);
  }
  if (fmt?.size) {
    const mb = (parseInt(fmt.size) / 1024 / 1024).toFixed(2);
    rows.push(['文件大小', `${mb} MB`]);
  }
  if (fmt?.bit_rate) {
    rows.push(['码率', `${Math.round(parseInt(fmt.bit_rate)/1000)} kbps`]);
  }

  area.innerHTML = rows.map(([k,v]) => v ? `
    <div class="meta-row">
      <span class="meta-key">${k}</span>
      <span class="meta-val">${v}</span>
    </div>` : '').join('');
}

function clearMetadata() {
  $('metadata-area').innerHTML = '';
}

// ── Conversion ────────────────────────────────────────────────────────────────
async function startConvert() {
  if (state.isConverting || !state.outputDir || !state.selectedFormat) return;

  const filesToConvert = state.files;
  if (filesToConvert.length === 0) {
    showToast('请先添加文件', 'error');
    return;
  }

  const btnConvert = $('btn-convert');

  // 右侧面板进度元素
  const rightProgressWrap  = $('right-progress-bar-wrap');
  const rightProgressFill  = $('right-progress-fill');
  const rightProgressLabel = $('right-progress-label');
  const rightProgressPct   = $('right-progress-pct');
  const rightResultsList   = $('right-results-list');
  const rightPlaceholder   = $('right-progress-placeholder');

  state.isConverting = true;
  btnConvert.disabled = true;
  btnConvert.innerHTML = '<span class="converting"><svg width="12" height="12" viewBox="0 0 40 40" fill="none" style="vertical-align:-1px"><path d="M20 4 L24 16 L38 16 L27 24 L31 36 L20 28 L9 36 L13 24 L2 16 L16 16 Z" fill="currentColor"/></svg></span><span>转换中...</span>';

  rightProgressWrap.style.display = 'block';
  rightProgressFill.style.width = '0%';
  rightProgressPct.textContent = '0%';
  rightProgressLabel.textContent = '准备中...';
  if (rightPlaceholder) rightPlaceholder.style.display = 'none';

  rightResultsList.innerHTML = '';
  const results = [];

  for (let i = 0; i < filesToConvert.length; i++) {
    const f = filesToConvert[i];
    rightProgressLabel.textContent = `转换中 ${i+1}/${filesToConvert.length}: ${f.name}`;
    rightProgressFill.style.width = '0%';
    rightProgressPct.textContent = '0%';

    // 获取文件时长用于精确进度计算
    state.currentDuration = 0;
    if (f.meta?.format?.duration) {
      state.currentDuration = parseFloat(f.meta.format.duration) || 0;
    }

    const outputName = filesToConvert.length === 1
      ? ($('output-name').value.trim() || 'output')
      : f.name.replace(/\.[^.]+$/, '').replace(/\[序列\]\s*/, '') + '_converted';

    const settings = buildSettings();
    const isSeq = f.isSequence;

    const options = {
      inputFiles: isSeq ? f.paths : [f.path],
      outputDir: state.outputDir,
      outputName,
      format: state.selectedFormat,
      settings,
      isSequence: isSeq,
      inputFps: isSeq ? parseFloat($('seq-fps').value) || 24 : null
    };

    addLog(`开始: ${f.name} → ${state.selectedFormat.label}`, 'start');

    try {
      const result = await window.api.startConvert(options);
      results.push({ ...result, inputName: f.name });
      if (result.success) {
        addLog(`✓ 完成: ${result.outputPath}`, 'success');
      } else {
        addLog(`✗ 错误: ${result.error}`, 'error');
      }
    } catch (e) {
      results.push({ success: false, error: e.message, inputName: f.name });
      addLog(`✗ 异常: ${e.message}`, 'error');
    }
  }

  state.isConverting = false;
  btnConvert.disabled = false;
  btnConvert.innerHTML = '<span><svg width="12" height="12" viewBox="0 0 40 40" fill="none" style="vertical-align:-1px"><path d="M20 4 L24 16 L38 16 L27 24 L31 36 L20 28 L9 36 L13 24 L2 16 L16 16 Z" fill="currentColor"/></svg></span><span>开始转换</span>';
  rightProgressFill.style.width = '100%';
  rightProgressPct.textContent = '100%';
  rightProgressLabel.textContent = `全部完成，共 ${results.length} 个文件`;

  renderResults(results);

  // 滚动中间设置区
  const settingsArea = $('settings-area');
  if (settingsArea) setTimeout(() => { settingsArea.scrollTop = settingsArea.scrollHeight; }, 100);

  const successCount = results.filter(r => r.success).length;
  showToast(`${successCount}/${results.length} 个文件转换完成`, successCount === results.length ? 'success' : 'error');
}

function buildSettings() {
  const cat = state.selectedCategory;
  if (cat === 'video') {
    const scale = $('scale-select').value;
    let w, h;
    if (scale) { [w, h] = scale.split('x').map(Number); }
    return {
      quality: parseInt($('quality').value),
      fps: $('fps-select').value || null,
      width: w, height: h,
      noAudio: $('toggle-no-audio').classList.contains('on')
    };
  } else if (cat === 'image') {
    return {
      quality: parseInt($('img-quality').value),
      width: parseInt($('img-width').value) || null,
      height: parseInt($('img-height').value) || null,
      loopCount: parseInt($('loop-count').value)   // 0=无限, 1+=次数
    };
  } else if (cat === 'audio') {
    return {
      audioBitrate: $('audio-bitrate').value || null
    };
  }
  return {};
}

function renderResults(results) {
  const rightResultsList = $('right-results-list');
  if (rightResultsList) rightResultsList.innerHTML = '';

  results.forEach(r => {
    const div = document.createElement('div');
    div.className = `result-item ${r.success ? 'ok' : 'fail'} fade-in`;
    const fileName = r.outputPath ? r.outputPath.split('/').pop() : r.inputName;
    div.innerHTML = `
      <div class="ri-icon">${r.success
        ? `<svg width="16" height="16" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="17" fill="rgba(34,211,165,0.15)" stroke="rgba(34,211,165,0.4)" stroke-width="1.5"/><path d="M11 20 L17 27 L29 13" stroke="#22d3a5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="17" fill="rgba(255,95,122,0.15)" stroke="rgba(255,95,122,0.4)" stroke-width="1.5"/><path d="M13 13 L27 27 M27 13 L13 27" stroke="#ff5f7a" stroke-width="2.5" stroke-linecap="round"/></svg>`
      }</div>
      <div class="ri-info">
        <div class="ri-name">${escapeHtml(fileName)}</div>
        <div class="ri-path">${escapeHtml(r.outputPath || r.error || '')}</div>
      </div>
      ${r.success ? `
        <div class="result-actions">
          <div class="btn-icon" title="在访达中显示" data-path="${escapeHtml(r.outputPath)}" data-action="reveal"><svg width="14" height="14" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="5" width="50" height="44" rx="9" fill="#2a2a2a"/><rect x="20" y="9" width="22" height="28" rx="5" fill="#d0d0d0" opacity="0.5" transform="rotate(6 31 23)"/><rect x="14" y="8" width="22" height="28" rx="5" fill="#e0e0e0" opacity="0.75" transform="rotate(-3 25 22)"/><rect x="3" y="22" width="46" height="25" rx="7" fill="#585858"/><rect x="3" y="22" width="46" height="25" rx="7" stroke="rgba(255,255,255,0.1)" stroke-width="1"/><path d="M8 23 Q8 19 12 19 L20 19 Q22 19 23 21 L24 23 Z" fill="#444"/></svg></div>
          <div class="btn-icon" title="打开文件" data-path="${escapeHtml(r.outputPath)}" data-action="open"><svg width="14" height="14" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="17" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/><path d="M15 12 L30 20 L15 28 Z" fill="rgba(255,255,255,0.7)"/></svg></div>
        </div>` : ''}
    `;
    div.querySelectorAll('.btn-icon').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.action === 'reveal') {
          await window.api.revealFile(btn.dataset.path);
        } else {
          await window.api.openFile(btn.dataset.path);
        }
      });
    });
    if (rightResultsList) rightResultsList.appendChild(div);
  });
}

// ── IPC / Progress ────────────────────────────────────────────────────────────
function setupIPC() {
  window.api.onProgress((data) => {
    const pct = Math.min(100, Math.max(0, data.percent || 0));
    $('progress-fill').style.width = `${pct}%`;
    $('progress-pct').textContent = `${Math.round(pct)}%`;
  });

  window.api.onLog((data) => {
    if (data.type === 'progress') return;
    addLog(data.message, data.type);
  });

  // 菜单快捷键 → 触发对应操作
  // 更新通知
  window.api.onMenuEvent && window.api.onMenuEvent('update-downloading', () => {
    addLog('正在下载新版本，请稍候…', 'start');
  });
  window.api.onMenuEvent && window.api.onMenuEvent('update-progress', (data) => {
    if (data) addLog(`下载中 ${data.percent}%  ${data.transferred}/${data.total}  ${data.bytesPerSecond}`, 'progress');
  });
  window.api.onMenuEvent && window.api.onMenuEvent('update-downloaded', () => {
    addLog('✓ 新版本下载完成，重启后生效', 'success');
    showToast('新版本已下载，重启安装', 'success');
  });

  window.api.onMenuEvent && window.api.onMenuEvent('menu-select-files', async () => {
    try {
      const files = await window.api.selectFiles();
      if (files && files.length > 0) { await addFiles(files); showToast(`已添加 ${files.length} 个文件`, 'success'); }
    } catch(e) { addLog(`选择文件出错: ${e.message}`, 'error'); }
  });
  window.api.onMenuEvent && window.api.onMenuEvent('menu-select-folder', async () => {
    try {
      const result = await window.api.selectFolder();
      if (result) await addFolderFiles(result);
    } catch(e) { addLog(`选择文件夹出错: ${e.message}`, 'error'); }
  });
  window.api.onMenuEvent && window.api.onMenuEvent('menu-select-output', async () => {
    try {
      const dir = await window.api.selectOutputDir();
      if (dir) {
        state.outputDir = dir;
        $('output-path-display').innerHTML = `<svg width="14" height="14" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-2px;margin-right:5px;flex-shrink:0"><rect x="1" y="5" width="50" height="44" rx="9" fill="#2e2e2e"/><rect x="20" y="9" width="22" height="28" rx="5" fill="#d0d0d0" opacity="0.5" transform="rotate(6 31 23)"/><rect x="14" y="8" width="22" height="28" rx="5" fill="#e0e0e0" opacity="0.75" transform="rotate(-3 25 22)"/><rect x="3" y="22" width="46" height="25" rx="7" fill="#5a5a5a"/><rect x="3" y="22" width="46" height="25" rx="7" stroke="rgba(255,255,255,0.1)" stroke-width="1"/><path d="M8 23 Q8 19 12 19 L20 19 Q22 19 23 21 L24 23 Z" fill="#444"/></svg>${escapeHtml(dir)}`;
        validateConvert();
        addLog(`输出文件夹: ${dir}`, 'info');
      }
    } catch(e) { addLog(`选择目录出错: ${e.message}`, 'error'); }
  });
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog(msg, type = 'info') {
  const logOutput = $('log-output');
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const div = document.createElement('div');
  div.className = `log-entry ${type}`;
  div.innerHTML = `<span class="le-time">${time}</span><span class="le-msg">${escapeHtml(msg)}</span>`;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
  while (logOutput.children.length > 200) logOutput.removeChild(logOutput.firstChild);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Validation ────────────────────────────────────────────────────────────────
function validateConvert() {
  const ok = state.files.length > 0 && state.selectedFormat && state.outputDir;
  $('btn-convert').disabled = !ok;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  // drop-zone 点击：选文件；点击"选择文件夹"链接：选文件夹
  $('drop-zone').addEventListener('click', async (e) => {
    if (e.target.closest('#dz-folder-link')) {
      e.stopPropagation();
      try {
        const result = await window.api.selectFolder();
        if (result) await addFolderFiles(result);
      } catch(err) { addLog(`选择文件夹出错: ${err.message}`, 'error'); }
      return;
    }
    try {
      const files = await window.api.selectFiles();
      if (files && files.length > 0) {
        await addFiles(files);
        showToast(`已添加 ${files.length} 个文件`, 'success');
      }
    } catch(err) { addLog(`选择文件出错: ${err.message}`, 'error'); }
  });

  // 清空
  $('btn-clear-all').addEventListener('click', clearAllFiles);

  // 格式标签
  $('format-tabs').querySelectorAll('.format-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $('format-tabs').querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderFormatGrid(tab.dataset.cat);
    });
  });

  // 输出文件夹
  $('output-path-display').addEventListener('click', async () => {
    try {
      const dir = await window.api.selectOutputDir();
      if (dir) {
        state.outputDir = dir;
        $('output-path-display').innerHTML = `<svg width="14" height="14" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-2px;margin-right:5px;flex-shrink:0"><rect x="1" y="5" width="50" height="44" rx="9" fill="#2e2e2e"/><rect x="20" y="9" width="22" height="28" rx="5" fill="#d0d0d0" opacity="0.5" transform="rotate(6 31 23)"/><rect x="14" y="8" width="22" height="28" rx="5" fill="#e0e0e0" opacity="0.75" transform="rotate(-3 25 22)"/><rect x="3" y="22" width="46" height="25" rx="7" fill="#5a5a5a"/><rect x="3" y="22" width="46" height="25" rx="7" stroke="rgba(255,255,255,0.1)" stroke-width="1"/><path d="M8 23 Q8 19 12 19 L20 19 Q22 19 23 21 L24 23 Z" fill="#444"/></svg>${escapeHtml(dir)}`;
        $('output-path-display').title = dir;
        validateConvert();
        addLog(`输出文件夹: ${dir}`, 'info');
      }
    } catch(e) {
      addLog(`选择输出目录出错: ${e.message}`, 'error');
    }
  });

  // 开始转换
  $('btn-convert').addEventListener('click', startConvert);

  // 质量滑块
  $('quality').addEventListener('input', () => $('quality-val').textContent = $('quality').value);
  $('img-quality').addEventListener('input', () => $('img-quality-val').textContent = $('img-quality').value);

  // 静音切换
  $('toggle-no-audio').addEventListener('click', function() {
    this.classList.toggle('on');
  });

  // 清空日志
  $('log-clear').addEventListener('click', () => {
    $('log-output').innerHTML = '';
    addLog('日志已清空。', 'info');
  });

  // ── 拖拽（Electron 32+ 必须用 webUtils.getPathForFile）──────────────────
  function getDropPaths(e) {
    const paths = [];
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      try {
        // Electron 32+ 新 API
        const p = window.api.getPathForFile(files[i]);
        if (p) paths.push(p);
      } catch (err) {
        // 降级：旧版 Electron file.path
        if (files[i].path) paths.push(files[i].path);
      }
    }
    return paths;
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    $('drop-zone').classList.remove('drag-over');
    const paths = getDropPaths(e);
    addLog(`拖入 ${paths.length} 个文件: ${paths.slice(0,2).map(p=>p.split('/').pop()).join(', ')}${paths.length>2?'...':''}`, 'info');
    if (paths.length > 0) {
      addFiles(paths);
      showToast(`已添加 ${paths.length} 个文件`, 'success');
    } else {
      showToast('未能获取文件路径，请使用"选择文件"按钮', 'error');
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    $('drop-zone').classList.add('drag-over');
  }

  function handleDragLeave(e) {
    // 只有离开整个窗口时才移除高亮
    if (!e.relatedTarget) {
      $('drop-zone').classList.remove('drag-over');
    }
  }

  document.addEventListener('dragover',  handleDragOver);
  document.addEventListener('dragleave', handleDragLeave);
  document.addEventListener('drop',      handleDrop);
}
