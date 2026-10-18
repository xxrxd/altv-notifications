import { pathToFileURL } from "node:url";

/**
 * @param {{
 *   key: string,
 *   server?: string,
 *   title: string,
 *   body: string,
 *   sound?: string,
 *   volume?: number,
 *   call?: boolean,
 *   level?: string,
 *   group?: string,
 * }} opts
 */
export async function sendBark(opts) {
  const key = String(opts.key || "").trim();
  if (!key) throw new Error("未配置 Bark Key");

  const server = (opts.server || "https://api.day.app").replace(/\/$/, "");
  let pushUrl;

  if (/^https?:\/\//i.test(key)) {
    // 用户填了完整推送 URL 前缀
    pushUrl = key.replace(/\/$/, "");
  } else {
    pushUrl = `${server}/${key}`;
  }

  const payload = {
    title: opts.title,
    body: opts.body,
    sound: opts.sound || "alarm",
    level: opts.level || "critical",
    volume: opts.volume ?? 10,
    group: opts.group || "gate-kline",
    isArchive: "1",
  };

  if (opts.call) {
    payload.call = "1";
  }

  // 优先 JSON POST（支持 call / volume / level）
  const res = await fetch(pushUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

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
 * 常用铃声列表（Bark）
 */
export const BARK_SOUNDS = [
  "alarm",
  "bell",
  "horn",
  "electronic",
  "glass",
  "multiwayinvitation",
  "paymentsuccess",
  "shake",
  "suspense",
  "telegraph",
  "update",
  "minuet",
  "fanfare",
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
    body: "这是一条 Bark 测试推送（call=1）",
    sound: "alarm",
    volume: 10,
    call: true,
    level: "critical",
  });
  console.log(result);
}
