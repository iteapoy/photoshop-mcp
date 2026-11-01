#!/bin/zsh
# 双击启动 Photoshop MCP 聊天界面（从本地源码仓库运行）
# 必须在「终端 / Terminal.app」里运行：WorkBuddy 进程内无法发送 Apple 事件（-10004）
# 源码：~/script/photoshop-mcp（已应用智谱规划修复 + 工具过滤补丁）

NODE=""
for candidate in "$HOME"/.workbuddy/binaries/node/versions/*/bin/node; do
  if [ -x "$candidate" ]; then
    NODE="$candidate"
  fi
done
if [ -z "$NODE" ]; then
  NODE="$(command -v node)"
fi

ROOT="$HOME/script/photoshop-mcp"
UI="$ROOT/dist/ui/cli.js"

if [ ! -f "$UI" ]; then
  echo "未找到 $UI，先构建一次：cd $ROOT && npm run build:server"
  echo "（build:server 依赖本机已装好依赖）"
  exit 1
fi

# 已有实例先结束，保证固定使用同一个地址
if pgrep -f "dist/ui/cli.js" >/dev/null 2>&1; then
  echo "检测到已运行的实例，正在替换为终端实例..."
  pkill -f "dist/ui/cli.js" >/dev/null 2>&1
  sleep 2
fi

echo "启动 Photoshop MCP 聊天界面（源码版）..."
echo "Node: $NODE"
echo "地址: http://127.0.0.1:5174"
echo "如果 macOS 弹出「终端 想要控制 Adobe Photoshop 2021」，请点「好」"
echo "（关闭这个终端窗口 = 服务停止）"
echo

exec "$NODE" "$UI" --port 5174
