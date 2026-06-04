# M-SHIFT v1.1.0 Release Notes

发布日期：2026-06-04

## ✨ 新增功能

### 1. 网络视频下载（全新页面）
- 顶部导航新增「下载 / 转换」两页切换
- 集成 yt-dlp 支持 1000+ 平台：YouTube、Bilibili、TikTok、Twitter/X、Instagram、Douyin、小红书等
- 自动从 GitHub 下载 yt-dlp 二进制（首次使用按钮触发）
- 支持视频 / 音频两种模式，画质可选 best / 1080p / 720p / 480p
- 集成 ffmpeg-static，下载视频自动合并 video+audio 为单个 mp4 文件
- 实时下载进度、可取消、独立日志区

### 2. 加密音乐解密（音频转换增强）
- 内置 `.ncm`（网易云音乐）解密：纯 Node 实现，零依赖，自动嗅探格式输出（flac/mp3/m4a/ogg）
- 自动从加密文件提取元数据（标题、艺术家、专辑）作为输出文件名
- 拖入 `.ncm` → 自动解密 → 自动加入转换队列
- 音频 tab 新增「🔓 加密音乐解锁」按钮，弹窗加载 unlock-music 在线工具支持 QQ/酷狗/酷我/虾米/咪咕/网易云全套格式

## 🐛 修复

- 修复音频格式转换误用 `videoCodec` 导致的 `libmp3lame is not available` 错误
- 修复 yt-dlp 安装后误判"未安装"的状态检测 bug（macOS Gatekeeper 首次校验超时）
- 修复 yt-dlp 下载视频得到分离 video+audio 两个文件未合并的问题
- 修复 UI 重构后转换页格式卡片不显示的多个连锁问题
- 修复 renderer.js 重复粘贴代码块导致的 SyntaxError

## 🔧 技术变更

- Electron 应用主进程加入 `downloader.js`、`musicDecrypt.js` 两个新模块
- IPC 新增：`download-url`、`get-ytdlp-status`、`install-ytdlp`、`cancel-download`、`music:decrypt`、`music:open-unlock-window` 等
- preload 安全暴露对应 API
- 安装包大小：基本不变（yt-dlp 按需从网络下载，不打入安装包）

## 📦 下载

- macOS Apple Silicon (M1/M2/M3): `M-SHIFT-1.1.0-arm64.dmg`
- macOS Intel: `M-SHIFT-1.1.0-x64.dmg`
- Windows x64: `M-SHIFT Setup 1.1.0.exe`
