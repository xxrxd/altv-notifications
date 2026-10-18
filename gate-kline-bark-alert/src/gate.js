import { pathToFileURL } from "node:url";

const GATE_HOST = "https://api.gateio.ws/api/v4";

/** @type {Record<string, number>} */
const INTERVAL_SECONDS = {
  "10s": 10,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "8h": 28800,
  "1d": 86400,
};

/**
 * @param {{ settle?: string, contract: string, interval?: string, limit?: number }} opts
 */
export async function fetchCandlesticks(opts) {
  const settle = opts.settle || "usdt";
  const interval = opts.interval || "15m";
  const limit = opts.limit ?? 5;
  const url = new URL(`${GATE_HOST}/futures/${settle}/candlesticks`);
  url.searchParams.set("contract", opts.contract);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gate API ${res.status}: ${text.slice(0, 200)}`);
  }
  /** @type {Array<{ t: number, o: string, c: string, h: string, l: string, v?: number|string }>} */
  const rows = await res.json();
  return rows.map(normalizeCandle);
}

/**
 * @param {{ t: number, o: string, c: string, h: string, l: string, v?: number|string }} row
 */
function normalizeCandle(row) {
  const open = Number(row.o);
  const close = Number(row.c);
  const high = Number(row.h);
  const low = Number(row.l);
  const body = Math.abs(close - open);
  return {
    t: Number(row.t),
    open,
    close,
    high,
    low,
    body,
    direction: close >= open ? "yang" : "yin",
    volume: row.v == null ? null : Number(row.v),
  };
}

/**
 * 取最近一根已收盘 K 线（不含影线的实体高度已在 body）
 * @param {Awaited<ReturnType<typeof fetchCandlesticks>>} candles
 * @param {string} interval
 * @param {number} [nowSec]
 */
export function getLatestClosedCandle(candles, interval, nowSec = Math.floor(Date.now() / 1000)) {
  const duration = INTERVAL_SECONDS[interval];
  if (!duration) throw new Error(`不支持的 interval: ${interval}`);

  const closed = candles
    .filter((c) => c.t + duration <= nowSec)
    .sort((a, b) => b.t - a.t);

  return closed[0] ?? null;
}

/**
 * @param {string} [settle]
 */
export async function listUsdtContracts(settle = "usdt") {
  const url = `${GATE_HOST}/futures/${settle}/contracts`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Gate contracts ${res.status}`);
  /** @type {Array<{ name: string }>} */
  const rows = await res.json();
  return rows.map((r) => r.name).sort();
}

export { INTERVAL_SECONDS };

// CLI smoke test: node src/gate.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const candles = await fetchCandlesticks({ contract: "ETH_USDT", interval: "15m", limit: 5 });
  const latest = getLatestClosedCandle(candles, "15m");
  console.log(JSON.stringify({ candles, latest }, null, 2));
}
