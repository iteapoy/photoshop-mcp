#!/bin/zsh
# 双击启动 Photoshop MCP 的 HTTP 桥接（给 WorkBuddy 用，不需要前端 UI）
#
# 作用：在「终端」身份下运行真正的 MCP 服务，并把工具通过 Streamable HTTP 暴露在
#       http://127.0.0.1:38471/mcp ，WorkBuddy 用自定义连接器（type=http）连这个地址。
# 为什么必须在终端里跑：WorkBuddy 进程发不出 Apple 事件（-10004），
# 只有终端派生的进程才能驱动 Photoshop。
#
# 关掉这个终端窗口 = 桥接停止，WorkBuddy 那边会连不上。

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
BRIDGE="$ROOT/scripts/mcp-http-bridge.mjs"
PORT=38471

if [ ! -f "$BRIDGE" ]; then
  echo "找不到桥接脚本：$BRIDGE"
  exit 1
fi
if [ ! -f "$ROOT/dist/index.js" ]; then
  echo "找不到 MCP 服务端：$ROOT/dist/index.js"
  echo "先构建一次：cd $ROOT && node scripts/clean-dist.mjs && npx tsc"
  exit 1
fi

# 已有桥接就先结束，避免端口占用
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "检测到已有桥接（端口 $PORT），正在替换..."
  pkill -f "mcp-http-bridge.mjs" >/dev/null 2>&1
  sleep 2
fi

echo "Photoshop MCP 桥接启动中..."
echo "Node   : $NODE"
echo "端口   : $PORT"
echo "工具模式: 分组（12 组 + action）；想恢复扁平 120 个工具，把 ~/.photoshop-mcp/tool-groups.json 的 enabled 改成 false"
echo "如果 macOS 弹出「终端 想要控制 Adobe Photoshop 2021」，请点「好」"
echo

FLAGS=()
if [ "$PHOTOSHOP_MCP_FLAT" = "1" ]; then
  FLAGS+=(--flat)
fi

exec "$NODE" "$BRIDGE" --port "$PORT" "${FLAGS[@]}"
