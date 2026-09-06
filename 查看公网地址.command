#!/bin/zsh
URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/zhaohui-tunnel.log 2>/dev/null | tail -1)
if [ -n "$URL" ]; then
  echo "$URL"
else
  echo "还没有找到公网地址，请先运行「启动报价单并挂公网.command」"
fi
