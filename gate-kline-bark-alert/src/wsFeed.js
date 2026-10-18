/**
 * Gate 合约 K 线 WebSocket：自动重连、换线路、订阅多合约。
 */

/**
 * @param {{
 *   getUrl: () => string | null,
 *   getContracts: () => string[],
 *   interval: string,
 *   onCandleUpdate: (evt: { contract: string, candle: any, closed: boolean, source: string }) => void,
 *   onStatus: (status: Record<string, unknown>) => void,
 *   log?: (...args: any[]) => void,
 * }} opts
 */
export function createWsFeed(opts) {
  const log = opts.log || console.log;
  /** @type {WebSocket | null} */
  let ws = null;
  let stopped = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let lastMessageAt = 0;
  /** @type {Map<string, any>} contract -> last candle snapshot */
  const lastByContract = new Map();

  function status(partial) {
    opts.onStatus({
      mode: "ws",
      connected: ws?.readyState === WebSocket.OPEN,
      url: opts.getUrl(),
      lastMessageAt,
      reconnectAttempt,
      ...partial,
    });
  }

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function subscribeAll() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const contracts = opts.getContracts();
    for (const contract of contracts) {
      ws.send(
        JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          channel: "futures.candlesticks",
          event: "subscribe",
          payload: [opts.interval, contract],
        })
      );
    }
    log(`[ws] subscribed ${contracts.join(",")} @ ${opts.interval}`);
  }

  function connect() {
    if (stopped) return;
    clearTimers();
    const url = opts.getUrl();
    if (!url) {
      status({ connected: false, error: "无可用 WS 线路" });
      scheduleReconnect();
      return;
    }

    try {
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    log(`[ws] connecting ${url}`);
    status({ connecting: true, error: null });
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      reconnectAttempt = 0;
      lastMessageAt = Date.now();
      status({ connected: true, connecting: false, error: null });
      subscribeAll();
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" }));
        }
        // 超过 45s 无消息视为假死，主动断开重连
        if (lastMessageAt && Date.now() - lastMessageAt > 45000) {
          log("[ws] stale, force reconnect");
          try {
            ws?.close();
          } catch {
            // ignore
          }
        }
      }, 15000);
    });

    ws.addEventListener("message", (ev) => {
      lastMessageAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      handleMessage(msg);
    });

    ws.addEventListener("error", () => {
      status({ connected: false, error: "WebSocket error" });
    });

    ws.addEventListener("close", () => {
      status({ connected: false, connecting: false });
      clearTimers();
      if (!stopped) scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectAttempt += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
    log(`[ws] reconnect in ${delay}ms (attempt ${reconnectAttempt})`);
    status({ reconnectInMs: delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // 换线路由外部 getUrl（探测结果）决定
      connect();
    }, delay);
  }

  /**
   * @param {any} msg
   */
  function handleMessage(msg) {
    if (msg.channel === "futures.pong") return;
    if (msg.channel !== "futures.candlesticks") return;
    if (msg.event === "subscribe") {
      if (msg.result?.status && msg.result.status !== "success") {
        status({ error: `subscribe failed: ${JSON.stringify(msg.result)}` });
      }
      return;
    }
    if (msg.event !== "update" || !Array.isArray(msg.result)) return;

    for (const row of msg.result) {
      const name = String(row.n || "");
      // n 形如 15m_ETH_USDT
      const contract = name.includes("_") ? name.slice(name.indexOf("_") + 1) : name;
      if (!contract) continue;

      const candle = {
        t: Number(row.t),
        open: Number(row.o),
        close: Number(row.c),
        high: Number(row.h),
        low: Number(row.l),
        body: Math.abs(Number(row.c) - Number(row.o)),
        direction: Number(row.c) >= Number(row.o) ? "yang" : "yin",
        volume: row.v == null ? null : Number(row.v),
      };
      const closedFlag = row.w === true || row.w === "true" || row.w === 1;

      const prev = lastByContract.get(contract);
      // 周期切换：上一根视为已收盘
      if (prev && prev.t !== candle.t) {
        opts.onCandleUpdate({
          contract,
          candle: prev,
          closed: true,
          source: "ws-rollover",
        });
      }

      lastByContract.set(contract, candle);

      if (closedFlag) {
        opts.onCandleUpdate({
          contract,
          candle,
          closed: true,
          source: "ws-window-close",
        });
      } else {
        opts.onCandleUpdate({
          contract,
          candle,
          closed: false,
          source: "ws-update",
        });
      }
    }
  }

  function start() {
    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    clearTimers();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    ws = null;
  }

  function restart() {
    stop();
    stopped = false;
    reconnectAttempt = 0;
    connect();
  }

  function resubscribe() {
    subscribeAll();
  }

  return { start, stop, restart, resubscribe, getLast: () => lastByContract };
}
