import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConfigStore } from "./configStore.js";
import { createMonitor } from "./monitor.js";
import { listUsdtContracts } from "./gate.js";
import { sendBark, BARK_SOUNDS } from "./bark.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const port = Number(process.env.PORT || 3780);

const store = createConfigStore(dataDir);
await store.load();

const monitor = createMonitor({ store });
monitor.start();

const publicDir = path.join(rootDir, "public");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, now: Date.now() });
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        config: store.getConfig(),
        state: publicState(store.getState()),
        sounds: BARK_SOUNDS,
        defaults: store.defaults,
      });
    }

    if (req.method === "PUT" && url.pathname === "/api/config") {
      const body = await readJson(req);
      const config = await store.updateConfig(body);
      monitor.restart();
      return json(res, 200, { ok: true, config });
    }

    if (req.method === "GET" && url.pathname === "/api/contracts") {
      const settle = url.searchParams.get("settle") || store.getConfig().settle || "usdt";
      const contracts = await listUsdtContracts(settle);
      return json(res, 200, { contracts });
    }

    if (req.method === "POST" && url.pathname === "/api/test-bark") {
      const config = store.getConfig();
      const body = await readJson(req).catch(() => ({}));
      const bark = { ...config.bark, ...(body.bark || {}) };
      const sound =
        (bark.customSound && String(bark.customSound).trim()) ||
        bark.sound ||
        "multiwayinvitation";
      const result = await sendBark({
        key: bark.key || config.bark.key,
        server: bark.server || config.bark.server,
        title: "Gate K线告警 · 测试",
        body: "GET 测试推送。call=1 约响 30 秒；critical 需在 Bark 开「重要警告」。",
        subtitle: "test",
        sound,
        volume: bark.volume,
        call: bark.call !== undefined ? Boolean(bark.call) : Boolean(config.bark.call),
        level: bark.level || config.bark.level,
        group: bark.group || config.bark.group || "gate-kline",
        ttl: bark.ttl ?? config.bark.ttl ?? 600,
        method: (bark.method || config.bark.method) === "POST" ? "POST" : "GET",
      });
      return json(res, 200, { ok: true, result });
    }

    if (req.method === "POST" && url.pathname === "/api/check-now") {
      await monitor.tick();
      return json(res, 200, { ok: true, state: publicState(store.getState()) });
    }

    // static
    if (req.method === "GET") {
      const filePath = await resolvePublic(publicDir, url.pathname);
      if (filePath) {
        const data = await fs.readFile(filePath);
        res.writeHead(200, { "Content-Type": contentType(filePath) });
        res.end(data);
        return;
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    json(res, 500, { error: msg });
  }
});

server.listen(port, () => {
  console.log(`[server] http://127.0.0.1:${port}`);
  console.log(`[server] dataDir=${dataDir}`);
});

function publicState(state) {
  return {
    lastCheckAt: state.lastCheckAt,
    lastError: state.lastError,
    alertedCount: Object.keys(state.alerted || {}).length,
  };
}

/**
 * @param {http.IncomingMessage} req
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} data
 */
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/**
 * @param {string} root
 * @param {string} pathname
 */
async function resolvePublic(root, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel);
  if (rel.includes("..")) return null;
  const full = path.join(root, rel);
  if (!full.startsWith(root)) return null;
  try {
    const st = await fs.stat(full);
    if (st.isFile()) return full;
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {string} filePath
 */
function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
