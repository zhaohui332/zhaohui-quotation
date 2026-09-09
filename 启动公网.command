#!/bin/zsh
cd "$(dirname "$0")"

BIN=".deploy-tools/cloudflared-bin"

if [ ! -x "$BIN" ]; then
  echo "正在准备 Cloudflare 隧道程序..."
  mkdir -p .deploy-tools
  curl -L --fail -o .deploy-tools/cloudflared.tgz \
    "https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-darwin-arm64.tgz"
  tar -xzf .deploy-tools/cloudflared.tgz -C .deploy-tools
  mv .deploy-tools/cloudflared "$BIN"
  chmod +x "$BIN"
fi

echo "请确认「启动报价单.command」已经运行。"
echo "正在建立公网地址，保持这个窗口打开即可。"
"$BIN" tunnel --no-autoupdate --url http://127.0.0.1:4731 2>&1 | tee /tmp/zhaohui-tunnel.log
