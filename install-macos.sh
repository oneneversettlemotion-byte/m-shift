#!/bin/bash
# M-SHIFT macOS 安装/修复脚本
# 用途：解决「M-SHIFT.app 已损坏，无法打开」或 Gatekeeper 阻拦问题
# 用法：双击运行；或在终端 cd 到本脚本目录，执行 ./install-macos.sh

set -e

APP_PATH="/Applications/M-SHIFT.app"
APP_PATH_USER="$HOME/Applications/M-SHIFT.app"

echo ""
echo "==========================================="
echo "   M-SHIFT macOS 安装修复脚本"
echo "==========================================="
echo ""

TARGET=""
if [ -d "$APP_PATH" ]; then
  TARGET="$APP_PATH"
elif [ -d "$APP_PATH_USER" ]; then
  TARGET="$APP_PATH_USER"
else
  echo "❌ 未在以下位置找到 M-SHIFT.app:"
  echo "   - $APP_PATH"
  echo "   - $APP_PATH_USER"
  echo ""
  echo "请先打开 dmg 安装包，把 M-SHIFT 拖入「应用程序」文件夹后再运行本脚本。"
  echo ""
  read -p "按回车键退出..."
  exit 1
fi

echo "✓ 找到应用：$TARGET"
echo ""
echo "正在移除 macOS 隔离标记（quarantine flag）..."
xattr -cr "$TARGET" 2>&1 || true
xattr -d com.apple.quarantine "$TARGET" 2>/dev/null || true

echo ""
echo "✓ 完成！现在你可以直接双击打开 M-SHIFT 了。"
echo ""
read -p "按回车键退出..."
