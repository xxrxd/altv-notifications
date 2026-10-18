import { fetchCandlesticks, getLatestClosedCandle } from "./gate.js";
import { sendBark } from "./bark.js";
import { formatLocalTime, isWithinTimeWindows } from "./timeWindow.js";

/**
 * @param {{
 *   store: ReturnType<import("./configStore.js").createConfigStore>,
 *   log?: (...args: any[]) => void,
 * }} deps
 */
export function createMonitor(deps) {
  const log = deps.log || console.log;
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    const store = deps.store;
    const config = store.getConfig();

    try {
      if (!config.enabled) {
        await store.setRuntime(null);
        return;
      }

      if (!isWithinTimeWindows(config.timeWindows, config.timezone)) {
        await store.setRuntime(null);
        return;
      }

      for (const contract of config.contracts) {
        await checkContract(contract, config, store, log);
      }
      await store.setRuntime(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("[monitor] error:", msg);
      await store.setRuntime(msg);
    } finally {
      running = false;
    }
  }

  function start() {
    stop();
    const ms = deps.store.getConfig().pollMs || 15000;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, ms);
    log(`[monitor] started, poll=${ms}ms`);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function restart() {
    start();
  }

  return { start, stop, restart, tick };
}

/**
 * @param {string} contract
 * @param {any} config
 * @param {any} store
 * @param {Function} log
 */
async function checkContract(contract, config, store, log) {
  const candles = await fetchCandlesticks({
    settle: config.settle,
    contract,
    interval: config.interval,
    limit: 6,
  });
  const candle = getLatestClosedCandle(candles, config.interval);
  if (!candle) return;

  const alertKey = `${contract}:${config.interval}:${candle.t}`;
  if (store.hasAlerted(alertKey)) return;

  if (candle.body < config.threshold) {
    return;
  }

  const dirLabel = candle.direction === "yang" ? "阳线" : "阴线";
  const when = formatLocalTime(candle.t, config.timezone);
  const title = `${config.bark.titlePrefix || "Gate K线告警"} · ${contract}`;
  const body = [
    `15m ${dirLabel} 实体 ${candle.body.toFixed(2)} ≥ ${config.threshold}`,
    `开 ${candle.open} → 收 ${candle.close}`,
    `K线开始 ${when}`,
  ].join("\n");

  log(`[alert] ${alertKey} body=${candle.body.toFixed(2)}`);

  await sendBark({
    key: config.bark.key,
    server: config.bark.server,
    title,
    body,
    sound: config.bark.sound,
    volume: config.bark.volume,
    call: Boolean(config.bark.call),
    level: config.bark.level,
    group: "gate-kline",
  });

  await store.markAlerted(alertKey);
}
