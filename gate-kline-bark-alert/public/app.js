const $ = (id) => document.getElementById(id);

const selected = new Set();
let sounds = [];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showMsg(text, isError = false) {
  const el = $("msg");
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function renderContracts(all) {
  const box = $("contractList");
  box.innerHTML = "";
  const popular = ["ETH_USDT", "BTC_USDT", "SOL_USDT", ...selected].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
  for (const name of popular) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${selected.has(name) ? " active" : ""}`;
    btn.textContent = name;
    btn.addEventListener("click", () => {
      if (selected.has(name)) selected.delete(name);
      else selected.add(name);
      renderContracts(all);
    });
    box.appendChild(btn);
  }
}

function renderWindows(windows) {
  const box = $("windows");
  box.innerHTML = "";
  (windows || []).forEach((win, idx) => {
    const row = document.createElement("div");
    row.className = "window";
    row.innerHTML = `
      <input data-k="start" type="text" value="${win.start || "00:00"}" placeholder="开始 HH:MM" />
      <input data-k="end" type="text" value="${win.end || "23:59"}" placeholder="结束 HH:MM" />
      <button type="button" class="ghost" data-del="${idx}">删</button>
    `;
    box.appendChild(row);
  });
  box.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = readWindows();
      list.splice(Number(btn.getAttribute("data-del")), 1);
      renderWindows(list);
    });
  });
}

function readWindows() {
  return [...$("windows").querySelectorAll(".window")].map((row) => {
    const start = row.querySelector('[data-k="start"]').value.trim();
    const end = row.querySelector('[data-k="end"]').value.trim();
    return { start, end };
  });
}

function fillForm(payload) {
  const { config, state, sounds: soundList } = payload;
  sounds = soundList || [];
  $("enabled").checked = Boolean(config.enabled);
  $("threshold").value = config.threshold;
  $("interval").value = config.interval || "15m";
  $("pollMs").value = config.pollMs;
  $("timezone").value = config.timezone;
  $("barkKey").value = config.bark?.key || "";
  $("barkServer").value = config.bark?.server || "https://api.day.app";
  $("barkCustomSound").value = config.bark?.customSound || "";
  $("barkVolume").value = config.bark?.volume ?? 10;
  $("barkVolumeOut").textContent = String($("barkVolume").value);
  $("barkLevel").value = config.bark?.level || "critical";
  $("barkGroup").value = config.bark?.group || "gate-kline";
  $("barkTtl").value = config.bark?.ttl ?? 600;
  $("barkCall").checked = Boolean(config.bark?.call);

  const soundSel = $("barkSound");
  soundSel.innerHTML = "";
  for (const s of sounds) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    soundSel.appendChild(opt);
  }
  soundSel.value = config.bark?.sound || "alarm";

  selected.clear();
  for (const c of config.contracts || []) selected.add(c);
  renderContracts([]);
  renderWindows(config.timeWindows?.length ? config.timeWindows : [{ start: "00:00", end: "23:59" }]);

  const last = state.lastCheckAt
    ? new Date(state.lastCheckAt).toLocaleString("zh-CN")
    : "尚未检测";
  const err = state.lastError ? ` · 错误: ${state.lastError}` : "";
  $("status").textContent = `最近检测: ${last} · 已记录告警 ${state.alertedCount}${err}`;
}

function collectConfig() {
  return {
    enabled: $("enabled").checked,
    contracts: [...selected],
    threshold: Number($("threshold").value),
    interval: $("interval").value,
    pollMs: Number($("pollMs").value),
    timezone: $("timezone").value.trim() || "Asia/Shanghai",
    timeWindows: readWindows(),
    bark: {
      key: $("barkKey").value.trim(),
      server: $("barkServer").value.trim(),
      sound: $("barkSound").value,
      customSound: $("barkCustomSound").value.trim(),
      volume: Number($("barkVolume").value),
      level: $("barkLevel").value,
      group: $("barkGroup").value.trim() || "gate-kline",
      ttl: Number($("barkTtl").value) || 600,
      call: $("barkCall").checked,
      method: "GET",
    },
  };
}

async function boot() {
  const data = await api("/api/config");
  fillForm(data);

  // 异步拉合约列表，丰富芯片
  api("/api/contracts")
    .then((r) => {
      const prefer = ["ETH_USDT", "BTC_USDT", "SOL_USDT", ...(r.contracts || [])];
      renderContracts(prefer);
    })
    .catch(() => {});

  $("barkVolume").addEventListener("input", () => {
    $("barkVolumeOut").textContent = $("barkVolume").value;
  });

  $("addContract").addEventListener("click", () => {
    const name = $("contractCustom").value.trim().toUpperCase();
    if (!name) return;
    selected.add(name);
    $("contractCustom").value = "";
    renderContracts([]);
  });

  $("addWindow").addEventListener("click", () => {
    const list = readWindows();
    list.push({ start: "09:00", end: "23:00" });
    renderWindows(list);
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const config = collectConfig();
      if (!config.contracts.length) throw new Error("至少选择一个合约");
      if (!config.bark.key) throw new Error("请填写 Bark Key");
      const saved = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      fillForm({ ...data, config: saved.config, state: (await api("/api/config")).state, sounds });
      showMsg("已保存");
    } catch (err) {
      showMsg(err.message || String(err), true);
    }
  });

  $("testBark").addEventListener("click", async () => {
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify(collectConfig()) });
      await api("/api/test-bark", { method: "POST", body: "{}" });
      showMsg("测试推送已发送，请看手机");
    } catch (err) {
      showMsg(err.message || String(err), true);
    }
  });

  $("checkNow").addEventListener("click", async () => {
    try {
      await api("/api/check-now", { method: "POST", body: "{}" });
      const latest = await api("/api/config");
      fillForm(latest);
      showMsg("已立即检测一次");
    } catch (err) {
      showMsg(err.message || String(err), true);
    }
  });
}

boot().catch((err) => {
  $("status").textContent = `加载失败: ${err.message || err}`;
});
