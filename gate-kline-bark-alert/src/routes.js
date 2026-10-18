/**
 * Gate 多线路：延迟探测，自动选最低延迟。
 * WS 为主，REST 为备用。
 */

/** @typedef {{ id: string, kind: 'ws'|'rest', url: string, label: string }} Route */

/** @type {Route[]} */
export const WS_ROUTES = [
  {
    id: "ws-fx-gateio",
    kind: "ws",
    url: "wss://fx-ws.gateio.ws/v4/ws/usdt",
    label: "FX-WS gateio.ws",
  },
];

/** @type {Route[]} */
export const REST_ROUTES = [
  {
    id: "rest-api-gateio",
    kind: "rest",
    url: "https://api.gateio.ws/api/v4",
    label: "REST api.gateio.ws",
  },
  {
    id: "rest-fx-api-gateio",
    kind: "rest",
    url: "https://fx-api.gateio.ws/api/v4",
    label: "REST fx-api.gateio.ws",
  },
];

/**
 * @param {number} [timeoutMs]
 * @returns {Promise<Array<Route & { latencyMs: number|null, ok: boolean, error?: string }>>}
 */
export async function probeAllRoutes(timeoutMs = 4000) {
  const list = [...WS_ROUTES, ...REST_ROUTES];
  const results = await Promise.all(list.map((r) => probeOne(r, timeoutMs)));
  return results.sort((a, b) => {
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    return (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
  });
}

/**
 * @param {'ws'|'rest'} kind
 * @param {Awaited<ReturnType<typeof probeAllRoutes>>} probed
 */
export function pickFastest(kind, probed) {
  return probed.find((r) => r.kind === kind && r.ok) || null;
}

/**
 * @param {Route} route
 * @param {number} timeoutMs
 */
async function probeOne(route, timeoutMs) {
  const t0 = Date.now();
  try {
    if (route.kind === "rest") {
      await withTimeout(
        fetch(`${route.url}/futures/usdt/candlesticks?contract=ETH_USDT&interval=15m&limit=1`, {
          headers: { Accept: "application/json" },
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await res.json();
        }),
        timeoutMs
      );
      return { ...route, ok: true, latencyMs: Date.now() - t0 };
    }

    const latencyMs = await probeWs(route.url, timeoutMs);
    return { ...route, ok: true, latencyMs };
  } catch (err) {
    return {
      ...route,
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
function probeWs(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ws = new WebSocket(url);
    let settled = false;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WS probe timeout"));
    }, timeoutMs);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
    }

    ws.addEventListener("open", () => {
      try {
        ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" }));
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    ws.addEventListener("message", () => {
      const ms = Date.now() - t0;
      cleanup();
      resolve(ms);
    });

    ws.addEventListener("error", () => {
      cleanup();
      reject(new Error("WS probe error"));
    });
  });
}

/**
 * @param {Promise<any>} promise
 * @param {number} ms
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
