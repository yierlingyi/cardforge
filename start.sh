#!/usr/bin/env bash
# CardForge 一键启动（macOS / Linux）
# 用法：bash start.sh  或  ./start.sh  或  ./start.sh --prod
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [错误] 未找到 Node.js"
  echo "  请先安装 Node.js 18 或更高版本：https://nodejs.org/"
  echo ""
  exit 1
fi

exec node scripts/launch.mjs "$@"
