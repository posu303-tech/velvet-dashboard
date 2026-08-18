"use strict";

const GATE_TICKER = "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=VELVET_USDT";
const GATE_CANDLES = "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=VELVET_USDT";
const GATE_WS = "wss://api.gateio.ws/ws/v4/";
const MEXC_BOOK = "https://api.mexc.com/api/v3/ticker/bookTicker?symbol=VELVETUSDT";
const PAIR = "VELVET_USDT";
const DAY = 86400;
const DAY_MS = DAY * 1000;

const BRIEF_VWAP = 0.5275;
const PRIOR_CLOSE = 0.5771;
const LEVELS = [
  { name: "R3", price: 1.3668, method: "pivot" },
  { name: "R2", price: 1.2064, method: "pivot" },
  { name: "R1", price: 0.8917, method: "pivot" },
  { name: "Pivot", price: 0.7313, method: "pivot" },
  { name: "VWMA20", price: 0.7119, method: "altFINS" },
  { name: "VAL 10s", price: 0.6800, method: "vol profile" },
  { name: "EMA9", price: 0.6728, method: "altFINS" },
  { name: "Fib 78.6%", price: 0.6055, method: "fib" },
  { name: "EMA26", price: 0.5943, method: "altFINS" },
  { name: "Prior close", price: PRIOR_CLOSE, method: "Aug 17 daily" },
  { name: "SMA20", price: 0.5605, method: "altFINS" },
  { name: "SMA50", price: 0.5591, method: "altFINS" },
  { name: "Session VWAP (brief)", price: BRIEF_VWAP, method: "brief 11:46 UTC" },
  { name: "Today low", price: 0.4812, method: "session" },
  { name: "Swing low / Fib 100%", price: 0.4284, method: "Aug 11 low" },
  { name: "S1", price: 0.4167, method: "pivot" },
  { name: "S2", price: 0.2562, method: "pivot" },
  { name: "S1 (screener)", price: 0.2608, method: "altFINS" },
  { name: "SMA200", price: 0.2744, method: "altFINS" }
];

const SETUPS = [
  {
    id: "A", name: "VWAP-reclaim long", dir: "LONG", longSide: true,
    stop: 0.4810, t1: 0.5771, t2: 0.6055, rr: "1.04 / 1.65",
    invalidate: "1h close back below 0.4812 (session low)",
    evaluate: (s) => ({
      valid: s.last >= s.vwap && s.last1hClose >= s.vwap,
      invalid: false,
      distPct: (s.vwap - s.last) / s.vwap * 100
    })
  },
  {
    id: "B", name: "VWAP-rejection short", dir: "SHORT", longSide: false,
    stop: 0.5775, t1: 0.4750, t2: 0.4284, rr: "1.05 / 1.98",
    invalidate: "last price >= 0.5771 (prior close)",
    evaluate: (s) => {
      const touched = s.sesHigh >= s.vwap;
      const distPct = (s.vwap - s.last) / s.vwap * 100;
      return {
        valid: touched && s.last < s.vwap,
        invalid: s.last >= PRIOR_CLOSE,
        distPct: s.last >= s.vwap ? 0 : distPct
      };
    }
  },
  {
    id: "C", name: "Breakdown continuation short", dir: "SHORT", longSide: false,
    stop: 0.5155, t1: 0.4284, t2: 0.3900, rr: "1.39 / 2.44",
    invalidate: "1h close back above 0.5155",
    evaluate: (s) => ({
      valid: s.last1hClose < 0.4812 && s.last < 0.4812,
      invalid: s.last1hClose >= 0.5155,
      distPct: (s.last - 0.4812) / 0.4812 * 100
    })
  },
  {
    id: "D", name: "Deep mean-reversion long", dir: "LONG", longSide: true,
    stop: 0.4120, t1: 0.4812, t2: 0.5275, rr: "2.00 / 4.00",
    invalidate: "1h close below 0.4120",
    evaluate: (s) => {
      const inZone = s.last >= 0.4284 && s.last <= 0.4400;
      const distPct = s.last < 0.4284 ? (0.4284 - s.last) / 0.4284 * 100 : (s.last - 0.4400) / 0.4400 * 100;
      return { valid: inZone, invalid: s.last1hClose < 0.4120, distPct: Math.max(0, distPct) };
    }
  }
];

const state = {
  last: null, bid: null, ask: null, change24: null, wsOk: false, restOk: false,
  sesOpen: null, sesHigh: null, sesLow: null, vwap: null, sesVol: 0,
  priorClose: PRIOR_CLOSE, priorVwap: null, avgVol20: null,
  atrDaily: null, atr1h: null, last1hClose: null,
  candles1m: [], lastUpdated: null, prevStatus: {}, fired: {}
};

const $ = (id) => document.getElementById(id);

function fmt(n, d = 4) {
  if (n === null || n === undefined || isNaN(n)) return "--";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtBig(n) {
  if (n === null || n === undefined || isNaN(n)) return "--";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function log(msg, cls) {
  const li = document.createElement("li");
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = new Date().toISOString().slice(11, 19) + "Z  ";
  li.appendChild(t);
  const e = document.createElement("span");
  e.className = cls || "ev";
  e.textContent = msg;
  li.appendChild(e);
  $("log").prepend(li);
  while ($("log").children.length > 60) $("log").lastChild.remove();
}

async function jfetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function refreshTicker() {
  try {
    const d = await jfetch(GATE_TICKER);
    if (d && d[0]) {
      state.last = parseFloat(d[0].last);
      state.bid = parseFloat(d[0].highest_bid);
      state.ask = parseFloat(d[0].lowest_ask);
      state.change24 = parseFloat(d[0].change_percentage);
      state.restOk = true;
    }
  } catch (e) { state.restOk = false; }
}

async function refreshMexc() {
  try {
    const d = await jfetch(MEXC_BOOK);
    state.bid = parseFloat(d.bidPrice);
    state.ask = parseFloat(d.askPrice);
  } catch (e) { /* keep gate bid/ask */ }
}

function gateCandles(interval, from, to, limit) {
  let u = GATE_CANDLES + "&interval=" + interval;
  if (from) u += "&from=" + from;
  if (to) u += "&to=" + to;
  if (limit) u += "&limit=" + limit;
  return jfetch(u);
}

async function refreshContext() {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(now / DAY) * DAY;
  const prevStart = dayStart - DAY;
  try {
    const [m1, h48, d22] = await Promise.all([
      gateCandles("1m", dayStart, now, null),
      gateCandles("1h", prevStart, now, 60),
      gateCandles("1d", null, null, 22)
    ]);
    const m1s = (m1 || []).map(c => ({ ts: +c[0], qv: +c[1], c: +c[2], h: +c[3], l: +c[4], o: +c[5], v: +c[6] }))
      .filter(c => c.ts >= dayStart).sort((a, b) => a.ts - b.ts);
    const h1s = (h48 || []).map(c => ({ ts: +c[0], c: +c[2], h: +c[3], l: +c[4], o: +c[5], v: +c[6] }))
      .sort((a, b) => a.ts - b.ts);
    const d1s = (d22 || []).map(c => ({ ts: +c[0], c: +c[2], h: +c[3], l: +c[4], o: +c[5], v: +c[6] }))
      .sort((a, b) => a.ts - b.ts);

    state.candles1m = m1s;
    if (m1s.length) {
      let pv = 0, tv = 0;
      state.sesOpen = m1s[0].o;
      state.sesHigh = Math.max(...m1s.map(c => c.h));
      state.sesLow = Math.min(...m1s.map(c => c.l));
      state.sesVol = m1s.reduce((a, c) => a + c.v, 0);
      for (const c of m1s) { pv += ((c.h + c.l + c.c) / 3) * c.v; tv += c.v; }
      state.vwap = tv > 0 ? pv / tv : null;
    }
    const yestH = h1s.filter(c => c.ts >= prevStart && c.ts < dayStart);
    if (yestH.length) {
      let pv = 0, tv = 0;
      for (const c of yestH) { pv += ((c.h + c.l + c.c) / 3) * c.v; tv += c.v; }
      state.priorVwap = tv > 0 ? pv / tv : null;
    }
    const closedH = h1s.filter(c => c.ts < now - 3600);
    if (closedH.length) state.last1hClose = closedH[closedH.length - 1].c;

    const prevDays = d1s.filter(c => c.ts < dayStart);
    if (prevDays.length) state.priorClose = prevDays[prevDays.length - 1].c;
    const last20 = prevDays.slice(-20);
    if (last20.length === 20) state.avgVol20 = last20.reduce((a, c) => a + c.v, 0) / 20;

    if (prevDays.length >= 15) {
      const last15 = prevDays.slice(-15);
      let trs = [];
      for (let i = 0; i < last15.length; i++) {
        const pc = i === 0 ? last15[0].o : last15[i - 1].c;
        trs.push(Math.max(last15[i].h - last15[i].l, Math.abs(last15[i].h - pc), Math.abs(last15[i].l - pc)));
      }
      state.atrDaily = trs.reduce((a, b) => a + b, 0) / trs.length;
    }
    if (h1s.length >= 15) {
      const last15 = h1s.slice(-15);
      let trs = [];
      for (let i = 0; i < last15.length; i++) {
        const pc = i === 0 ? last15[0].o : last15[i - 1].c;
        trs.push(Math.max(last15[i].h - last15[i].l, Math.abs(last15[i].h - pc), Math.abs(last15[i].l - pc)));
      }
      state.atr1h = trs.reduce((a, b) => a + b, 0) / trs.length;
    }
    state.lastUpdated = new Date();
  } catch (e) { log("context refresh failed: " + e.message, "ev"); }
}

function progressFor(setup, distPct) {
  const w = 5;
  return clamp((w - distPct) / w, 0, 1) * 100;
}

function evaluate() {
  if (state.last === null) return;
  const s = {
    last: state.last, vwap: state.vwap || BRIEF_VWAP,
    last1hClose: state.last1hClose, sesHigh: state.sesHigh
  };
  for (const setup of SETUPS) {
    const r = setup.evaluate(s);
    let status = "armed";
    if (r.invalid) status = "invalid";
    else if (r.valid) status = "valid";
    else if (progressFor(setup, r.distPct) >= 80) status = "near";
    const prev = state.prevStatus[setup.id];
    if (status === "valid" && prev !== "valid") fireTrigger(setup);
    state.prevStatus[setup.id] = status;
    renderSetup(setup, r, status);
  }
}

function fireTrigger(setup) {
  const key = setup.id + "_" + new Date().toUTCString().slice(0, 16);
  if (state.fired[key]) return;
  state.fired[key] = true;
  const dirTxt = setup.dir === "LONG" ? "LONG" : "SHORT";
  log("TRIGGER FIRED — Setup " + setup.id + " " + setup.name + " (" + dirTxt + ") @ " + fmt(state.last), "ok");
  log("Levels — entry zone reached; stop " + fmt(setup.stop) + " | T1 " + fmt(setup.t1) + " | T2 " + fmt(setup.t2), "ev");
  const banner = $("triggerBanner");
  banner.classList.remove("hidden");
  banner.classList.toggle("down", setup.dir !== "LONG");
  banner.textContent = "TRIGGER — Setup " + setup.id + ": " + setup.name + " VALIDATED @ " + fmt(state.last) + " — enter zone reached";
  setTimeout(() => banner.classList.add("hidden"), 8000);
  beep(setup.dir === "LONG" ? 880 : 660);
  setTimeout(() => beep(setup.dir === "LONG" ? 1320 : 440), 250);
  if (Notification.permission === "granted") {
    try {
      new Notification("VELVET-USD TRIGGER — Setup " + setup.id, {
        body: setup.name + " validated @ " + fmt(state.last) + " | stop " + fmt(setup.stop) + " | T1 " + fmt(setup.t1)
      });
    } catch (e) { /* notifications unsupported */ }
  }
}

function renderSetup(setup, r, status) {
  const el = $("setup-" + setup.id);
  if (!el) return;
  el.querySelector(".pill").textContent = status.toUpperCase();
  el.querySelector(".pill").className = "pill " + status;
  el.querySelector(".mx-price").textContent = fmt(state.last);
  el.querySelector(".mx-trigger").textContent = fmt(setup.triggerPrice());
  const prox = progressFor(setup, r.distPct);
  const fill = el.querySelector(".prox-fill");
  fill.style.width = prox + "%";
  fill.classList.toggle("full", prox >= 100);
  el.querySelector(".prox-pct").textContent = r.distPct > 0 ? "-" + fmt(r.distPct, 2) + "% to trigger" : "AT TRIGGER";
  el.querySelector(".mx-inval").textContent = setup.invalidate;
}

function renderPrice() {
  const el = $("lastPrice");
  if (state.last === null) return;
  const up = state.last >= state.priorClose;
  el.textContent = fmt(state.last);
  el.className = "last-price " + (up ? "up" : "down");
  $("priceMeta").textContent =
    "bid " + fmt(state.bid) + " / ask " + fmt(state.ask) +
    "  ·  24h " + (state.change24 !== null ? state.change24.toFixed(2) : "--") + "%  ·  prior close " + fmt(state.priorClose);
  $("sOpen").textContent = fmt(state.sesOpen);
  $("sHighLow").textContent = fmt(state.sesHigh) + " / " + fmt(state.sesLow);
  $("sVwap").textContent = fmt(state.vwap) + (state.vwap !== null ? " (brief " + fmt(BRIEF_VWAP) + ")" : "");
  $("pClose").textContent = fmt(state.priorClose);
  $("pVwap").textContent = fmt(state.priorVwap);
  $("sesVol").textContent = fmtBig(state.sesVol);
  $("avgVol").textContent = fmtBig(state.avgVol20);
  $("volRatio").textContent = state.avgVol20 ? (state.sesVol / state.avgVol20).toFixed(2) + "x" : "--";
  $("atr").textContent = fmt(state.atrDaily) + " / " + fmt(state.atr1h);
  $("lastUpdate").textContent = state.lastUpdated ? state.lastUpdated.toISOString().slice(11, 19) + "Z" : "--";
  $("utcClock").textContent = new Date().toISOString().slice(11, 19) + "Z";
  $("sessionDate").textContent = new Date().toISOString().slice(0, 10);
  renderLevels();
  drawSpark();
}

function renderLevels() {
  const tb = $("levelRows");
  tb.innerHTML = "";
  for (const lv of LEVELS) {
    const tr = document.createElement("tr");
    const above = state.last !== null && state.last >= lv.price;
    tr.innerHTML =
      "<td>" + lv.name + "</td>" +
      "<td class='lv-price'>" + fmt(lv.price) + "</td>" +
      "<td class='" + (above ? "lv-above" : "lv-below") + "'>" +
      (state.last === null ? "--" : (above ? "+" : "-") + fmt(Math.abs(state.last - lv.price) / lv.price * 100, 2) + "%") + "</td>" +
      "<td class='lv-method'>" + lv.method + "</td>";
    tb.appendChild(tr);
  }
}

function drawSpark() {
  const cv = $("spark");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const cs = state.candles1m;
  if (cs.length < 2) return;
  const prices = cs.map(c => c.c);
  const min = Math.min(...prices, ...(state.vwap ? [state.vwap] : []), 0.4284, 0.4812) * 0.995;
  const max = Math.max(...prices, ...(state.vwap ? [state.vwap] : []), 0.5771) * 1.005;
  const X = (i) => (i / (cs.length - 1)) * W;
  const Y = (p) => H - ((p - min) / (max - min)) * H;
  ctx.strokeStyle = "#2ecc8f";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  cs.forEach((c, i) => i === 0 ? ctx.moveTo(X(i), Y(c.c)) : ctx.lineTo(X(i), Y(c.c)));
  ctx.stroke();
  const hLines = [
    [state.vwap, "#42c6e8"], [0.5771, "#f5b83d"], [0.4812, "#ff5c6c"], [0.4284, "#ff5c6c"]
  ];
  for (const [p, col] of hLines) {
    if (p === null) continue;
    ctx.strokeStyle = col;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, Y(p));
    ctx.lineTo(W, Y(p));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.font = "10px monospace";
    ctx.fillText(p.toFixed(4), 4, Y(p) - 3);
  }
}

function beep(freq) {
  try {
    const ac = state.audioCtx;
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = freq;
    o.type = "square";
    g.gain.setValueAtTime(0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
    o.connect(g); g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.55);
  } catch (e) { /* audio blocked */ }
}

function connectWS() {
  let ws;
  const open = () => {
    ws = new WebSocket(GATE_WS);
    ws.onopen = () => {
      state.wsOk = true;
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.tickers", event: "subscribe", payload: [PAIR] }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.event === "update" && msg.channel === "spot.tickers") {
        const r = msg.result;
        if (r && r.last) {
          state.last = parseFloat(r.last);
          if (r.lowest_ask) state.ask = parseFloat(r.lowest_ask);
          if (r.highest_bid) state.bid = parseFloat(r.highest_bid);
          if (r.change_percentage !== undefined) state.change24 = parseFloat(r.change_percentage);
          evaluate();
        }
      }
    };
    ws.onclose = () => { state.wsOk = false; setTimeout(open, 3000); };
    ws.onerror = () => { try { ws.close(); } catch (e) { } };
  };
  open();
  setInterval(() => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" }));
    }
  }, 30000);
}

function buildSetups() {
  const wrap = $("setups");
  wrap.innerHTML = "";
  for (const setup of SETUPS) {
    setup.triggerPrice = () => setup.id === "A" || setup.id === "B" ? (state.vwap || BRIEF_VWAP) :
      setup.id === "C" ? 0.4812 : 0.4284;
    const div = document.createElement("div");
    div.className = "setup";
    div.id = "setup-" + setup.id;
    div.innerHTML =
      "<div class='head'><span class='sid'>" + setup.id + "</span>" +
      "<span class='sname'>" + setup.name + "</span>" +
      "<span class='dir " + (setup.dir === "LONG" ? "long" : "short") + "'>" + setup.dir + "</span>" +
      "<span class='pill'>armed</span></div>" +
      "<div class='metrics'>" +
      "<span>Price <b class='mx-price'>--</b></span>" +
      "<span>Trigger <b class='mx-trigger'>--</b></span>" +
      "<span>Stop <b>" + fmt(setup.stop) + "</b></span>" +
      "<span>T1 <b>" + fmt(setup.t1) + "</b></span>" +
      "<span>T2 <b>" + fmt(setup.t2) + "</b></span>" +
      "<span>R:R <b>" + setup.rr + "</b></span>" +
      "</div>" +
      "<div class='prox-row'><div class='prox-bar'><div class='prox-fill'></div></div><div class='prox-pct'>--</div></div>" +
      "<div class='inval'>Invalidation: <b class='mx-inval'>--</b></div>";
    wrap.appendChild(div);
  }
}

$("notifBtn").addEventListener("click", () => {
  try {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    beep(880);
  } catch (e) { }
  if ("Notification" in window) {
    Notification.requestPermission().then((p) => {
      log("browser alerts: " + p, p === "granted" ? "ok" : "ev");
    });
  }
  log("audio armed", "ok");
});

function setFeedUi() {
  const wd = $("wsDot"), wl = $("wsLabel"), rd = $("restDot"), rl = $("restLabel");
  wd.className = "dot " + (state.wsOk ? "ok" : "err");
  wl.textContent = state.wsOk ? "WS live (tick stream)" : "WS down — REST fallback";
  rd.className = "dot " + (state.restOk ? "ok" : "err");
  rl.textContent = state.restOk ? "REST polling 1s" : "REST failing";
}

(async function init() {
  buildSetups();
  await refreshContext();
  await refreshTicker();
  evaluate();
  renderPrice();
  connectWS();
  setInterval(refreshTicker, 1000);
  setInterval(refreshMexc, 2000);
  setInterval(refreshContext, 60000);
  setInterval(() => { renderPrice(); setFeedUi(); }, 1000);
  setInterval(() => { $("utcClock").textContent = new Date().toISOString().slice(11, 19) + "Z"; }, 1000);
  setInterval(() => { if (state.last !== null) evaluate(); }, 2000);
  log("monitor started — tick stream (Gate WS) + REST fallback (Gate/MEXC)", "ok");
})();