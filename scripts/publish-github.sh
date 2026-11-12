#!/usr/bin/env bash
# 把 release/ 里的 Windows 包发到 GitHub Releases（开源免费分发）
#   bash scripts/publish-github.sh 1.0.0
# 依赖：gh（已登录）、release/ 里已有 .exe
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('./package.json').version")"
fi

cd "$(dirname "$0")/.."

if [ ! -d release ]; then
  echo "没有 release/，先跑 npm run dist:win" >&2
  exit 1
fi

cd release
for f in *.exe; do sha256sum "$f" >> SHA256SUMS.txt; done
cat SHA256SUMS.txt
cd ..

NOTES="changelog/CHANGELOG-${VERSION}.md"
[ -f "$NOTES" ] || NOTES="changelog/CHANGELOG.md"

gh release create "v${VERSION}" release/*.exe release/SHA256SUMS.txt \
  --title "Yuhox Board v${VERSION}" \
  --notes-file "$NOTES"

echo "→ 已发布 v${VERSION}"
