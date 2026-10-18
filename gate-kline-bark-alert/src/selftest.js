import { getLatestClosedCandle } from "./gate.js";
import { isWithinTimeWindows } from "./timeWindow.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 实体与收盘判定
const now = 1_700_000_900; // 对齐某个整点后
const candles = [
  { t: 1_700_000_000, open: 100, close: 112, high: 120, low: 90, body: 12, direction: "yang", volume: 1 },
  { t: 1_700_000_900, open: 112, close: 111, high: 115, low: 110, body: 1, direction: "yin", volume: 1 },
];
const closed = getLatestClosedCandle(candles, "15m", now);
assert(closed && closed.t === 1_700_000_000, "应取已收盘那根");
assert(closed.body === 12, "实体应为 |c-o|");

// 时间段：普通 + 跨午夜
assert(isWithinTimeWindows([{ start: "09:00", end: "18:00" }], "UTC", new Date("2024-01-01T10:00:00Z")), "应在窗口内");
assert(!isWithinTimeWindows([{ start: "09:00", end: "18:00" }], "UTC", new Date("2024-01-01T20:00:00Z")), "应在窗口外");
assert(isWithinTimeWindows([{ start: "22:00", end: "06:00" }], "UTC", new Date("2024-01-01T23:00:00Z")), "跨午夜内");
assert(!isWithinTimeWindows([{ start: "22:00", end: "06:00" }], "UTC", new Date("2024-01-01T12:00:00Z")), "跨午夜外");

console.log("selftest ok");
