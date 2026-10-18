import { fetchCandlesticks, getLatestClosedCandle, INTERVAL_SECONDS } from "./gate.js";
import { sendBark } from "./bark.js";
import { formatLocalTime, isWithinTimeWindows } from "./timeWindow.js";
import { createWsFeed } from "./wsFeed.js";
import { pickFastest, probeAllRoutes } from "./routes.js";

/**
 * @param {{
 *   store: ReturnType<import("./configStore.js").createConfigStore>,
 *   log?: (...args: any[]) => void,
 * }} deps
 */
export function createMonitor(deps) {
  const log = deps.log || console.log;
  const store = deps.store;

  /** @type {any} */
  let liveStatus = {
    feed: "starting",
    ws: null,
    rest: null,
    routes: [],
    lastCandle: null,
    lastAlertAt: null,
  };

  let restTimer = null;
  let probeTimer = null;
  let restBusy = false;
  /** @type {ReturnType<typeof createWsFeed> | null} */
  let feed = null;
  /** @type {string | null} */
  let bestWsUrl = null;
  /** @type {string | null} */
  let bestRestUrl = null;

  function getStatus() {
    return { ...liveStatus, bestWsUrl, bestRestUrl };
  }

  async function refreshRoutes() {
    const probed = await probeAllRoutes(4000);
    liveStatus.routes = probed.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      url: r.url,
      ok: r.ok,
      latencyMs: r.latencyMs,
      error: r.error || null,
    }));
    const ws = pickFastest("ws", probed);
    const rest = pickFastest("rest", probed);
    const prevWs = bestWsUrl;
    bestWsUrl = ws?.url || null;
    bestRestUrl = rest?.url || null;
    liveStatus.ws = ws
      ? { id: ws.id, url: ws.url, latencyMs: ws.latencyMs }
      : null;
    liveStatus.rest = rest
      ? { id: rest.id, url: rest.url, latencyMs: rest.latencyMs }
      : null;
    log(
      `[route] best WS=${bestWsUrl || "none"} (${ws?.latencyMs ?? "-"}ms) REST=${bestRestUrl || "none"} (${rest?.latencyMs ?? "-"}ms)`
    );
    if (feed && prevWs && bestWsUrl && bestWsUrl !== prevWs) {
      log("[route] WS endpoint changed, restarting feed");
      feed.restart();
    }
    return probed;
  }

  /**
   * @param {{ contract: string, candle: any, closed: boolean, source: string }} evt
   */
  async function onCandleUpdate(evt) {
    liveStatus.lastCandle = {
      contract: evt.contract,
      t: evt.candle.t,
      body: evt.candle.body,
      closed: evt.closed,
      source: evt.source,
      at: Date.now(),
    };
    if (!evt.closed) return;
    try {
      await maybeAlert(evt.contract, evt.candle, evt.source);
      await store.setRuntime(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("[monitor] alert error:", msg);
      await store.setRuntime(msg);
    }
  }

  /**
   * @param {string} contract
   * @param {any} candle
   * @param {string} source
   */
  async function maybeAlert(contract, candle, source) {
    const config = store.getConfig();
    if (!config.enabled) return;
    if (!isWithinTimeWindows(config.timeWindows, config.timezone)) return;

    const alertKey = `${contract}:${config.interval}:${candle.t}`;
    if (store.hasAlerted(alertKey)) return;
    if (candle.body < config.threshold) return;

    const dirLabel = candle.direction === "yang" ? "阳线" : "阴线";
    const when = formatLocalTime(candle.t, config.timezone);
    const title = `${config.bark.titlePrefix || "Gate K线告警"} · ${contract}`;
    const body = [
      `${config.interval} ${dirLabel} 实体 ${candle.body.toFixed(2)} ≥ ${config.threshold}`,
      `开 ${candle.open} → 收 ${candle.close}`,
      `K线开始 ${when}`,
      `来源 ${source}`,
    ].join("\n");

    log(`[alert] ${alertKey} body=${candle.body.toFixed(2)} via ${source}`);

    const sound =
      (config.bark.customSound && String(config.bark.customSound).trim()) ||
      config.bark.sound ||
      "multiwayinvitation";

    await sendBark({
      key: config.bark.key,
      server: config.bark.server,
      title,
      body,
      subtitle: `${contract} · 实体 ${candle.body.toFixed(2)}`,
      sound,
      volume: config.bark.volume,
      call: Boolean(config.bark.call),
      level: config.bark.level,
      group: config.bark.group || "gate-kline",
      ttl: config.bark.ttl ?? 600,
      method: config.bark.method === "POST" ? "POST" : "GET",
    });

    liveStatus.lastAlertAt = Date.now();
    await store.markAlerted(alertKey);
  }

  async function restSafetyTick() {
    if (restBusy) return;
    restBusy = true;
    const config = store.getConfig();
    try {
      if (!config.enabled) {
        await store.setRuntime(null);
        return;
      }

      const wsOk = liveStatus.feed === "ws" && liveStatus.wsConnected;
      // WS 正常时：仅在 K 线刚收盘的一小段窗口补检；WS 异常时：全速 REST 兜底
      const duration = INTERVAL_SECONDS[config.interval] || 900;
      const nowSec = Math.floor(Date.now() / 1000);
      const sinceClose = nowSec % duration;
      const nearClose = sinceClose <= 20 || sinceClose >= duration - 2;
      if (wsOk && !nearClose) {
        await store.setRuntime(null);
        return;
      }

      if (!bestRestUrl) await refreshRoutes();
      const baseUrl = bestRestUrl;
      if (!baseUrl) throw new Error("无可用 REST 线路");

      liveStatus.feed = wsOk ? "ws+rest-verify" : "rest-fallback";

      for (const contract of config.contracts) {
        const candles = await fetchCandlesticks({
          settle: config.settle,
          contract,
          interval: config.interval,
          limit: 6,
          baseUrl,
        });
        const candle = getLatestClosedCandle(candles, config.interval);
        if (!candle) continue;
        await maybeAlert(contract, candle, wsOk ? "rest-verify" : "rest-fallback");
      }
      await store.setRuntime(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("[rest] error:", msg);
      await store.setRuntime(msg);
      // REST 失败时立刻再探测线路
      void refreshRoutes().catch(() => {});
    } finally {
      restBusy = false;
    }
  }

  function start() {
    stop();
    const config = store.getConfig();

    feed = createWsFeed({
      getUrl: () => bestWsUrl,
      getContracts: () => store.getConfig().contracts,
      interval: config.interval || "15m",
      onCandleUpdate,
      onStatus: (s) => {
        liveStatus.wsConnected = Boolean(s.connected);
        liveStatus.wsStatus = s;
        if (s.connected) liveStatus.feed = "ws";
        else if (!bestWsUrl) liveStatus.feed = "rest-fallback";
      },
      log,
    });

    void (async () => {
      await refreshRoutes();
      if (bestWsUrl) {
        feed?.start();
        liveStatus.feed = "ws";
      } else {
        liveStatus.feed = "rest-fallback";
        log("[monitor] no WS route, REST-only");
      }
    })();

    const restMs = Math.max(5000, Number(config.restPollMs || config.pollMs || 10000));
    void restSafetyTick();
    restTimer = setInterval(() => {
      void restSafetyTick();
    }, restMs);

    const probeMs = Math.max(30000, Number(config.routeProbeMs || 60000));
    probeTimer = setInterval(() => {
      void refreshRoutes().catch((e) => log("[route] probe fail", e));
    }, probeMs);

    log(`[monitor] started restPoll=${restMs}ms routeProbe=${probeMs}ms`);
  }

  function stop() {
    if (restTimer) {
      clearInterval(restTimer);
      restTimer = null;
    }
    if (probeTimer) {
      clearInterval(probeTimer);
      probeTimer = null;
    }
    feed?.stop();
    feed = null;
  }

  function restart() {
    start();
  }

  async function tick() {
    await refreshRoutes();
    await restSafetyTick();
  }

  return { start, stop, restart, tick, getStatus, refreshRoutes };
}
