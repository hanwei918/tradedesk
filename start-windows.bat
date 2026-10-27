@echo off
chcp 65001 >nul
rem 双击启动 TradeDesk（Windows）。第一次运行会准备演示数据。
cd /d "%~dp0app"
where python >nul 2>nul || (echo 没有找到 python，请先安装 Python 3.9+，安装时勾选 Add python.exe to PATH & pause & exit /b 1)
if not exist .env copy .env.demo .env >nul
python -c "import PIL" 2>nul || python -m pip install --user pillow
if not exist state\board.json (
  echo 第一次运行：用回放缓存准备看板、收件箱和任务数据...
  set "TRADEDESK_MODE=replay"
  python tools\record_demo.py >nul || (echo 准备演示数据失败 & pause & exit /b 1)
  set "TRADEDESK_MODE="
)
start "" http://127.0.0.1:8765
python server.py %*
pause
