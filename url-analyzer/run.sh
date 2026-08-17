#!/bin/sh
# 启动「网页URL智能解析助手」
set -e
BUNDLED_NODE="/Users/zhoumo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if command -v node >/dev/null 2>&1; then NODE=node
elif [ -x "$BUNDLED_NODE" ]; then NODE="$BUNDLED_NODE"
else echo "未找到 Node.js（需要 ≥ 22.5）" >&2; exit 1; fi
exec "$NODE" server.js "$@"
