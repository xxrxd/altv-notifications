import { pathToFileURL } from "node:url";

/**
 * 按 Bark 官方参数推送：https://bark.day.app/#/params
 *
 * 推荐 GET：
 *   https://api.day.app/{key}/{title}/{body}?group=...&ttl=600&sound=...&call=1&level=critical&volume=10
 *
 * 也支持 JSON POST（同名参数）。
 *
 * 关于「电话铃声」：
 * Bark 不能直接读系统来电铃声，但可在 App 里导入自定义 .caf（≤30s），
 * 然后把 sound 填成导入后的铃声名。把 iPhone 铃声转成 .caf 导入即可尽量接近来电声。
 *
 * @param {{
 *   key: string,
 *   server?: string,
 *   title: string,
 *   body: string,
 *   subtitle?: string,
 *   sound?: string,
 *   volume?: number,
 *   call?: boolean,
 *   level?: string,
 *   group?: string,
 *   ttl?: number,
 *   isArchive?: string | number,
 *   method?: "GET" | "POST",
 * }} opts
 */
export async function sendBark(opts) {
  const key = String(opts.key || "").trim();
  if (!key) throw new Error("未配置 Bark Key");

  const server = (opts.server || "https://api.day.app").replace(/\/$/, "");
  const method = opts.method || "GET";

  /** @type {Record<string, string>} */
  const query = {
    group: opts.group || "gate-kline",
  };

  if (opts.subtitle) query.subtitle = opts.subtitle;
  if (opts.sound) query.sound = opts.sound;
  if (opts.level) query.level = opts.level;
  if (opts.volume != null && opts.volume !== "") query.volume = String(opts.volume);
  if (opts.call) query.call = "1";
  if (opts.ttl != null) query.ttl = String(opts.ttl);
  if (opts.isArchive != null) query.isArchive = String(opts.isArchive);

  let res;
  if (method === "POST") {
    const pushUrl = /^https?:\/\//i.test(key)
      ? key.replace(/\/$/, "")
      : `${server}/${key}`;
    res = await fetch(pushUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        ...query,
      }),
    });
  } else {
    // GET：/key/title/body?params — 与用户示例一致
    const base = /^https?:\/\//i.test(key)
      ? key.replace(/\/$/, "")
      : `${server}/${encodeURIComponent(key)}`;
    const title = encodeURIComponent(opts.title);
    const body = encodeURIComponent(opts.body);
    const qs = new URLSearchParams(query).toString();
    const url = `${base}/${title}/${body}?${qs}`;
    res = await fetch(url, { method: "GET" });
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!res.ok || (json && json.code !== 200 && json.code !== undefined)) {
    throw new Error(`Bark 推送失败: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  return json ?? { raw: text };
}

/**
 * Bark 内置铃声（也可在 UI 里填「自行导入的 .caf 名称」）
 * 接近来电提示的可试：multiwayinvitation / alarm / horn
 */
export const BARK_SOUNDS = [
  "alarm",
  "multiwayinvitation",
  "bell",
  "horn",
  "electronic",
  "glass",
  "paymentsuccess",
  "shake",
  "suspense",
  "telegraph",
  "update",
  "minuet",
  "fanfare",
  "bloom",
  "calypso",
  "chime",
  "choo",
  "descent",
  "gotosleep",
  "healthnotification",
  "ladder",
  "mailsent",
  "newmail",
  "newsflash",
  "noir",
  "sherwoodforest",
  "spell",
  "tiptoes",
  "typewriters",
  "birdsong",
];

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun && process.argv.includes("--test")) {
  const key = process.env.BARK_KEY;
  if (!key) {
    console.error("请设置环境变量 BARK_KEY 后再测试");
    process.exit(1);
  }
  const result = await sendBark({
    key,
    title: "Gate K线告警测试",
    body: "GET 推送测试：critical + call=1，持续响铃约 30 秒",
    sound: process.env.BARK_SOUND || "multiwayinvitation",
    volume: 10,
    call: true,
    level: "critical",
    group: "gate-kline",
    ttl: 600,
    method: "GET",
  });
  console.log(result);
}
