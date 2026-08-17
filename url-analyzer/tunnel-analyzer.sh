#!/bin/sh
# 一键开启临时外网链接：把本机 4000 端口（网页解析助手）映射成公网地址，发给朋友用手机打开
set -e

BIN=""
for c in ./cloudflared ../cloudflared ~/Downloads/cloudflared ~/Downloads/cloudflared\ 2; do
  if [ -x "$c" ]; then BIN="$c"; break; fi
done

if [ -z "$BIN" ]; then
  echo "未找到 cloudflared。"
  echo "请先下载 cloudflared-darwin-arm64.tgz（Apple 芯片版），解压后把 cloudflared 文件放进本文件夹或下载文件夹。"
  exit 1
fi

echo "使用：$BIN"
echo "正在建立外网链接，第一次运行需要几秒钟……"
echo "出现 https://xxx.trycloudflare.com 后，把整串地址发给朋友即可。按 Ctrl+C 可关闭外网访问。"
echo
"$BIN" tunnel --url http://localhost:4000
