#!/usr/bin/env bash
# 在本机 Mac 安装为开机自启、崩溃自动拉起的常驻服务（launchd）
set -euo pipefail

LABEL="com.xxrxd.gate-kline-bark-alert"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$ROOT/mac/${LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/gate-kline-bark-alert"
DATA_DIR="$ROOT/data"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$DATA_DIR"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "未找到 node。请先安装 Node.js 18+（建议: brew install node）"
  exit 1
fi

# 解析真实路径，避免 nvm/brew shim 在 launchd 下失效
NODE_BIN="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$NODE_BIN")"
echo "使用 Node: $NODE_BIN"
echo "项目目录: $ROOT"

# 生成 plist
sed \
  -e "s|__NODE__|$NODE_BIN|g" \
  -e "s|__ROOT__|$ROOT|g" \
  -e "s|__HOME__|$HOME|g" \
  "$PLIST_SRC" > "$PLIST_DST"

# 若已加载则先卸下
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl unload "$PLIST_DST" 2>/dev/null || true

launchctl bootstrap "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || launchctl load "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl start "$LABEL"

sleep 1
echo ""
echo "已安装并启动。"
echo "  设置页: http://127.0.0.1:3780"
echo "  日志:   $LOG_DIR/stdout.log"
echo "  卸载:   $ROOT/scripts/uninstall-macos.sh"
echo ""
echo "建议（24 小时在线）：系统设置 → 电池/节能 → 接通电源时防止自动休眠；Mac 接电源。"
echo "可选防休眠: caffeinate -s &   （仅在接电源时阻止系统睡眠）"

# 打开设置页
open "http://127.0.0.1:3780" 2>/dev/null || true
