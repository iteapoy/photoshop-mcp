#!/bin/zsh
# 双击启动 Photoshop MCP 聊天界面（源码仓库 + 自动重载版）
# 与 start-ui.command 的区别：用 node --watch 运行，改动 src/ 或 dist/ 后进程自动重启。
# 配置 ~/.photoshop-mcp/tool-filter.json 本身就是热生效的（改完下一个请求即用）。
# 必须在「终端 / Terminal.app」里运行：WorkBuddy 进程内无法发送 Apple 事件（-10004）

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
PORT=5174

if [ ! -f "$UI" ]; then
  echo "未找到 $UI，先构建一次：cd $ROOT && npm run build:server"
  exit 1
fi

if pgrep -f "dist/ui/cli.js" >/dev/null 2>&1; then
  echo "检测到已运行的实例，正在替换为终端实例..."
  pkill -f "dist/ui/cli.js" >/dev/null 2>&1
  sleep 2
fi

echo "启动 Photoshop MCP 聊天界面（watch 模式）..."
echo "Node: $NODE"
echo "地址: http://127.0.0.1:$PORT"
echo "改 $ROOT/dist 下的代码会自动重启；改 tool-filter.json 无需重启"
echo "（关闭这个终端窗口 = 服务停止）"
echo

exec "$NODE" --watch "$UI" --port "$PORT"
