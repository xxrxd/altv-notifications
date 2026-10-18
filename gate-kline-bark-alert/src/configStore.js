import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  enabled: true,
  contracts: ["ETH_USDT"],
  settle: "usdt",
  interval: "15m",
  /** 实体高度阈值（USDT 报价单位，ETH 默认 10 点 = 10 USDT） */
  threshold: 10,
  /** 时区，用于时间段判断 */
  timezone: "Asia/Shanghai",
  /** 允许告警的时间段，空数组表示全天 */
  timeWindows: [{ start: "00:00", end: "23:59" }],
  bark: {
    /** Bark 设备 Key，或完整推送前缀 https://api.day.app/xxx */
    key: "",
    /** 服务器地址，默认官方 */
    server: "https://api.day.app",
    /**
     * 铃声名：内置如 multiwayinvitation / alarm，或 Bark App 里导入的 .caf 自定义名。
     * 无法直接使用系统「电话」铃声；把来电铃声转成 .caf 导入后填名称即可。
     */
    sound: "multiwayinvitation",
    /** 自定义铃声名（优先于 sound 下拉），用于导入的电话铃声 .caf */
    customSound: "",
    /** critical 级别音量 0-10；配合 call 更接近来电 */
    volume: 10,
    /** call=1 循环响铃约 30 秒 */
    call: true,
    /** active | timeSensitive | critical | passive */
    level: "critical",
    /** 分组，同 group 可在通知中心归组 */
    group: "gate-kline",
    /** 历史记录保留秒数，对应官方 ttl */
    ttl: 600,
    /** GET 与官方示例一致；也可 POST */
    method: "GET",
    titlePrefix: "Gate K线告警",
  },
  /** 轮询间隔毫秒 */
  pollMs: 15000,
};

/**
 * @param {string} dataDir
 */
export function createConfigStore(dataDir) {
  const configPath = path.join(dataDir, "config.json");
  const statePath = path.join(dataDir, "state.json");

  /** @type {typeof DEFAULT_CONFIG} */
  let config = structuredClone(DEFAULT_CONFIG);
  /** @type {{ alerted: Record<string, number>, lastCheckAt: number | null, lastError: string | null }} */
  let state = { alerted: {}, lastCheckAt: null, lastError: null };

  async function ensureDir() {
    await fs.mkdir(dataDir, { recursive: true });
  }

  async function load() {
    await ensureDir();
    try {
      const raw = await fs.readFile(configPath, "utf8");
      config = mergeConfig(DEFAULT_CONFIG, JSON.parse(raw));
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code !== "ENOENT") {
        throw err;
      }
      if (process.env.BARK_KEY) {
        config.bark.key = process.env.BARK_KEY;
      }
      await saveConfig();
    }

    try {
      const raw = await fs.readFile(statePath, "utf8");
      state = { ...state, ...JSON.parse(raw) };
      if (!state.alerted || typeof state.alerted !== "object") state.alerted = {};
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code !== "ENOENT") {
        throw err;
      }
      await saveState();
    }

    return { config, state };
  }

  async function saveConfig() {
    await ensureDir();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  }

  async function saveState() {
    await ensureDir();
    // 只保留最近 7 天记录，避免无限增长
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [key, ts] of Object.entries(state.alerted)) {
      if (typeof ts !== "number" || ts < cutoff) delete state.alerted[key];
    }
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  }

  function getConfig() {
    return config;
  }

  function getState() {
    return state;
  }

  /**
   * @param {Partial<typeof DEFAULT_CONFIG>} patch
   */
  async function updateConfig(patch) {
    config = mergeConfig(config, patch);
    // 基础校验
    if (!Array.isArray(config.contracts) || config.contracts.length === 0) {
      config.contracts = ["ETH_USDT"];
    }
    config.contracts = [...new Set(config.contracts.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
    config.threshold = Number(config.threshold);
    if (!Number.isFinite(config.threshold) || config.threshold <= 0) {
      config.threshold = 10;
    }
    config.pollMs = Math.max(5000, Number(config.pollMs) || 15000);
    if (!config.bark || typeof config.bark !== "object") {
      config.bark = structuredClone(DEFAULT_CONFIG.bark);
    }
    config.bark.volume = Math.min(10, Math.max(0, Number(config.bark.volume) || 10));
    await saveConfig();
    return config;
  }

  /**
   * @param {string} alertKey
   */
  function hasAlerted(alertKey) {
    return Boolean(state.alerted[alertKey]);
  }

  /**
   * @param {string} alertKey
   */
  async function markAlerted(alertKey) {
    state.alerted[alertKey] = Date.now();
    await saveState();
  }

  /**
   * @param {string | null} error
   */
  async function setRuntime(error) {
    state.lastCheckAt = Date.now();
    state.lastError = error;
    await saveState();
  }

  return {
    load,
    getConfig,
    getState,
    updateConfig,
    hasAlerted,
    markAlerted,
    setRuntime,
    defaults: DEFAULT_CONFIG,
  };
}

/**
 * @param {any} base
 * @param {any} patch
 */
function mergeConfig(base, patch) {
  const out = structuredClone(base);
  if (!patch || typeof patch !== "object") return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = { ...out[key], ...value };
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
