#!/bin/sh
# 自动查找可用的 Node.js 运行时并启动「先存着」
set -e
BUNDLED_NODE="/Users/zhoumo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "$BUNDLED_NODE" ]; then
  NODE="$BUNDLED_NODE"
else
  echo "未找到 Node.js（需要 ≥ 22.5），请先安装 Node.js。" >&2
  exit 1
fi
exec "$NODE" server/index.js "$@"
