#!/bin/zsh
cd "$(dirname "$0")"

echo "正在启动本机报价单服务..."
NODE="/Users/lijunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
PYTHON="/Users/lijunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
export NODE_PATH="/Users/lijunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
export ZHAOHUI_PYTHON="$PYTHON"

"$NODE" server.js > /tmp/zhaohui-server.log 2>&1 &
SERVER_PID=$!

sleep 1
exec "$(pwd)/启动公网.command"
