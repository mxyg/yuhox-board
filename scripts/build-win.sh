#!/usr/bin/env bash
# 出 Windows 安装包（供运维台编译台与本地使用）
#   bash scripts/build-win.sh --version 1.0.0
# 产物：release/*.exe（NSIS 安装包 + 便携版）
set -euo pipefail

VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

cd "$(dirname "$0")/.."

if [ -n "$VERSION" ]; then
  echo "→ 版本号写入 $VERSION"
  npm version --no-git-tag-version --allow-same-version "$VERSION" >/dev/null
fi

echo "→ 安装依赖"
npm install --no-audit --no-fund

echo "→ 构建 Windows 安装包"
npx electron-builder --win --x64

echo "→ 产物："
ls -lh release/*.exe
