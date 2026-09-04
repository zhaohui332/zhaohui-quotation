#!/bin/zsh
cd "$(dirname "$0")"

NODE="/Users/lijunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
PYTHON="/Users/lijunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
export NODE_PATH="/Users/lijunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
export ZHAOHUI_PYTHON="$PYTHON"

exec "$NODE" server.js
