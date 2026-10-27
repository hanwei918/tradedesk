#!/bin/bash
# 双击启动 TradeDesk（macOS）。第一次运行会准备演示数据。
cd "$(dirname "$0")/app" || exit 1
command -v python3 >/dev/null || { echo "没有找到 python3，请先安装 Python 3.9+（https://www.python.org/downloads/）"; read -r; exit 1; }
[ -f .env ] || cp .env.demo .env
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --user pillow
if [ ! -f state/board.json ]; then
  echo "第一次运行：用回放缓存准备看板、收件箱和任务数据…"
  TRADEDESK_MODE=replay python3 tools/record_demo.py >/dev/null || { echo "准备演示数据失败"; read -r; exit 1; }
fi
(sleep 2; open "http://127.0.0.1:8765") &
python3 server.py "$@"
