/**
 * 判断当前时间是否落在任一时间段内（按指定时区）
 * @param {Array<{ start: string, end: string }>} windows
 * @param {string} timeZone
 * @param {Date} [now]
 */
export function isWithinTimeWindows(windows, timeZone, now = new Date()) {
  if (!Array.isArray(windows) || windows.length === 0) return true;

  const minutesNow = localMinutes(now, timeZone);
  for (const win of windows) {
    const start = parseHm(win.start);
    const end = parseHm(win.end);
    if (start == null || end == null) continue;

    if (start <= end) {
      if (minutesNow >= start && minutesNow <= end) return true;
    } else {
      // 跨午夜，如 22:00-06:00
      if (minutesNow >= start || minutesNow <= end) return true;
    }
  }
  return false;
}

/**
 * @param {Date} date
 * @param {string} timeZone
 */
function localMinutes(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const minute = Number(parts.minute);
  return hour * 60 + minute;
}

/**
 * @param {string} hm
 * @returns {number | null}
 */
function parseHm(hm) {
  if (typeof hm !== "string") return null;
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * @param {number} unixSec
 * @param {string} timeZone
 */
export function formatLocalTime(unixSec, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(unixSec * 1000));
}
