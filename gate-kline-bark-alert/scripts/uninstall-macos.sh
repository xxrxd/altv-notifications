#!/usr/bin/env bash
set -euo pipefail

LABEL="com.xxrxd.gate-kline-bark-alert"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl unload "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"
echo "已卸载开机自启服务 $LABEL"
