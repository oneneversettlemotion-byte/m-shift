# M-SHIFT

专业的多媒体格式转换 & 网络视频下载工具（Electron 桌面应用）

## 功能

- 🎬 **视频/图片/音频格式转换**：基于 ffmpeg，支持几十种格式互转
- ⬇️ **网络视频下载**：基于 yt-dlp，支持 YouTube、Bilibili、TikTok 等 1000+ 平台
- 🔓 **加密音乐解锁**：内置 .ncm（网易云）解密 + 集成 unlock-music 在线工具

## 下载安装

最新版本：[Releases 页面](https://github.com/oneneversettlemotion-byte/m-shift/releases/latest)

| 平台 | 文件 |
|---|---|
| macOS Apple Silicon (M1/M2/M3) | `M-SHIFT-x.x.x-macOS-AppleSilicon.dmg` |
| macOS Intel | `M-SHIFT-x.x.x-macOS-Intel.dmg` |
| Windows x64 | `M-SHIFT-x.x.x-Windows-x64-Setup.exe` |

---

## macOS 安装说明

由于本应用未使用 Apple Developer 证书（$99/年）签名，macOS Gatekeeper 会拦截。**任选一种方法**即可正常打开：

### 方法 1：使用一键修复脚本（推荐）⭐

1. 把 dmg 里的 `M-SHIFT.app` 拖入「应用程序」文件夹
2. 下载 [`install-macos.sh`](https://github.com/oneneversettlemotion-byte/m-shift/releases/latest)
3. 打开「终端」，把脚本拖入终端窗口，回车执行
4. 完成后双击 M-SHIFT 即可正常打开

### 方法 2：终端一行命令

```bash
xattr -cr /Applications/M-SHIFT.app
```
之后双击打开即可。

### 方法 3：右键打开

1. 在「访达 → 应用程序」中找到 M-SHIFT
2. **按住 Control 键** 点击图标 → 选择「打开」
3. 弹窗里点「打开」
4. 首次打开后以后双击即可

### 方法 4：系统设置允许

1. 双击 M-SHIFT（会被拦截）
2. 打开「系统设置 → 隐私与安全性」
3. 拉到底部，找到「已阻止 M-SHIFT」 → 点「仍要打开」

---

## Windows 安装说明

1. 双击 `.exe` 安装包
2. SmartScreen 弹窗 → 点「更多信息」→「仍要运行」
3. 按向导完成安装

---

## 视频下载首次使用

打开应用 → 切到「下载」页 → 点击「安装 yt-dlp」按钮，应用会自动从 GitHub 下载二进制到本地（约 30 MB）。

---

## 已知限制

- QQ 音乐 `.mgg/.mflac` 等 2022+ 新加密格式需要 EKey，在线解锁工具不支持，仅本机内置支持 `.ncm`（网易云）
- 苹果芯片机上的 Intel 包用 Rosetta 跑也可以，但不如 ARM 包流畅

---

## 开发

```bash
cd m-shift
npm install
npm start

# 打包
npx electron-builder --mac dmg --arm64 --x64 --publish never
npx electron-builder --win nsis --x64 --publish never
```
