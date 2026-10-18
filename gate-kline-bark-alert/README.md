# Gate K线实体监测 + Bark 强提醒

云端轮询 [Gate.io](https://www.gate.com) 合约 **15 分钟 K 线**。当**最新已收盘**一根 K 线的**实体高度**（`|收盘 - 开盘|`，不含影线）≥ 阈值（默认 10）时，通过 [Bark](https://github.com/Finb/Bark) 向 iPhone 推送最高级提醒（支持 `critical` + `call` 持续响铃）。

阴阳线均触发。监测在服务器上跑，**手机熄屏也能收到**（依赖苹果推送，不要求网页常开）。

## 快速开始

```bash
cd gate-kline-bark-alert
npm start
# 浏览器打开 http://127.0.0.1:3780
```

1. iPhone 安装 Bark，复制设备 **Key**
2. 打开配置页，填入 Key，选合约（如 `ETH_USDT`），设阈值 / 时间段 / 铃声
3. 点「测试 Bark」，确认熄屏也能响
4. 点「保存设置」

## 判定规则

- 只看 **已收盘** 的最新一根（当前未走完的那根不告警）
- 实体 = `|close - open|`
- 影线（high / low）不计入
- 阳线、阴线都告警
- 同一根 K 线只推一次

## 可配置项

| 项 | 说明 |
| --- | --- |
| 合约 | 多选，如 ETH_USDT、BTC_USDT |
| 阈值 | 实体高度，默认 10（USDT 报价点） |
| 时间段 | 按时区（默认 Asia/Shanghai），可跨午夜 |
| 铃声 / 音量 | Bark `sound` + `volume`（0–10，仅 critical 生效） |
| 自定义铃声 | Bark App 导入的 `.caf` 名称（可接近电话铃声） |
| call | `call=1` 循环响铃约 30 秒 |
| group / ttl | 与官方一致，如 `group=gate-kline&ttl=600` |
| level | 建议 `critical` 或 `timeSensitive` |

### 想用 iPhone 电话铃声？

Bark **不能直接**调用系统来电铃声。可行做法：

1. 把喜欢的来电铃声做成 **≤30 秒的 `.caf`**
2. 打开 Bark → 铃声设置 → 导入
3. 在本页「自定义铃声名」填导入后的名字
4. 打开 `call=1` + `level=critical` + 音量 10，接近「强提醒来电」体验

推送 URL 形态（与官方一致）：

```text
GET https://api.day.app/{key}/{title}/{body}?group=gate-kline&ttl=600&sound=...&call=1&level=critical&volume=10
```

## 部署（需 24 小时在线）

本机或任意能跑 Node 18+ 的机器 / Docker：

```bash
docker build -t gate-kline-bark-alert .
docker run -d --name gate-alert -p 3780:3780 -v gate-alert-data:/data gate-kline-bark-alert
```

也可用 Railway、Fly.io、轻量云主机等常驻进程。**不能用手机本地网页后台代替**，iOS 会挂起轮询。

环境变量：

- `PORT` 默认 `3780`
- `DATA_DIR` 默认 `./data`
- `BARK_KEY` 可选，首次写入默认配置

## API

- `GET /api/config` 当前配置与状态
- `PUT /api/config` 更新配置
- `GET /api/contracts` Gate USDT 合约列表
- `POST /api/test-bark` 测试推送
- `POST /api/check-now` 立即检测一次

## 说明

- Gate 行情接口无需 API Key
- Bark `critical` / `call` 需在系统与 App 内按说明开启；若系统限制，可改用 `timeSensitive` + 较大音量铃声
- 本目录可整体拷贝到独立 Git 仓库使用
