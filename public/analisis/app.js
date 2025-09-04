/* CriptoBot Pro — v5.3 (Full Binance OHLC, 100% gratis)
 * - OHLC y precios: Binance (/api/v3/klines, /api/v3/exchangeInfo)
 * - Futuros (contexto): Binance UMFutures (funding, L/S, OI, basis)
 * - Top 20 por MC: CoinGecko (1 request, sin key)
 * - FX ARS/EUR: exchangerate.host (gratis)
 * - Explicación simple: usa tu explainDecision() simplificada
 */
export { }; // <- hace que sea ES module y evita "already been declared"
const $w = window; // acceso explícito a globals (Chart, bootstrap, etc.)

"use strict";

/* ===== DEBUG ===== */
const __CBP_DBG__ = (localStorage.getItem("cbp_debug") ?? "1") === "1";
const tsLocal = () =>
  new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour12: false,
  });
const dlog = (...a) => { if (__CBP_DBG__) console.log(`[CBP ${tsLocal()}]`, ...a); };
const dtime = (label) => { if (__CBP_DBG__) console.time(`[CBP ⏱ ${label}]`); };
const dtimeEnd = (label) => { if (__CBP_DBG__) console.timeEnd(`[CBP ⏱ ${label}]`); };

// Marca de arranque
dlog("app.js module loaded");


/* ===========================
   ====== Config & Utils ======
   =========================== */

const CG_BASE = "https://api.coingecko.com/api/v3"; // solo 1 request (top por MC)
const BINANCE_SPOT = "https://api.binance.com";
const BINANCE_FUT = "https://fapi.binance.com"; // UMFutures (USDT-M)
const FNG_URL = "https://api.alternative.me/fng/?limit=1";
const COINSTATS_NEWS = "https://api.coinstats.app/public/v1/news?skip=0&limit=20";
const FX_URL = "https://api.exchangerate.host/latest?base=USD";
const ALLORIGINS = (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

const $ = (sel) => document.querySelector(sel);
const nowTs = () => new Date().toISOString();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pct = (x, dec = 2) => (isFinite(x) ? `${x.toFixed(dec)}%` : "—");
const rnd = (x, dec = 2) => (isFinite(x) ? Number(x.toFixed(dec)) : x);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const stdev = (arr) => { const m = mean(arr); const v = mean(arr.map((x) => (x - m) ** 2)); return Math.sqrt(v); };
const logret = (arr) => arr.slice(1).map((c, i) => Math.log(c / arr[i]));
const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtMoney = (ccy) => new Intl.NumberFormat("en-US", { style: "currency", currency: ccy.toUpperCase(), maximumFractionDigits: ccy.toLowerCase() === "ars" ? 0 : 2 });

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function escapeHtml(s) { return (s ?? "").toString().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function mdToHtml(md) { return md.replace(/^(\*{2})(.+?)\1/gm, "<strong>$2</strong>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>"); }

/* ===========================
   ========= Fetchers =========
   =========================== */

async function fetchJSON(url, headers = {}) {
  const abs = (() => {
    try { return new URL(url, location.href).href; } catch { return url; }
  })();
  const label = `fetch ${abs}`;
  dtime(label);
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    dtimeEnd(label);
    dlog("ok", abs);
    return j;
  } catch (e1) {
    dlog("fetch failed, trying proxy", abs, e1?.message || e1);
    try {
      const r2 = await fetch(ALLORIGINS(url), { headers });
      if (!r2.ok) throw new Error(`Proxy HTTP ${r2.status}`);
      let j = null;
      try { j = await r2.json(); } catch { j = null; }
      dtimeEnd(label);
      dlog("ok (via proxy)", abs);
      return j;
    } catch (e2) {
      dtimeEnd(label);
      dlog("proxy failed", abs, e2?.message || e2);
      return null;
    }
  }
}


// FX: USD→ARS/EUR (gratis)
let __FX__ = { USD: 1, ARS: NaN, EUR: NaN };
async function ensureFX() {
  dtime("FX rates");
  try {
    const j = await fetchJSON(FX_URL);
    __FX__.USD = 1;
    __FX__.EUR = Number(j?.rates?.EUR) || NaN;
    __FX__.ARS = Number(j?.rates?.ARS) || NaN;
    dlog("FX", __FX__);
  } catch {
    dlog("FX failed");
  } finally {
    dtimeEnd("FX rates");
  }
}

function fxConv(usdPrice, vs) {
  if (vs === "usd") return usdPrice;
  if (vs === "eur" && isFinite(__FX__.EUR)) return usdPrice * __FX__.EUR;
  if (vs === "ars" && isFinite(__FX__.ARS)) return usdPrice * __FX__.ARS;
  return usdPrice; // fallback USD
}

// Top por MC filtrado a los que cotizan en Binance/USDT (spot)
async function fetchTopMarketCapOnBinance({ vs = "usd", topn = 20 }) {
  dtime("TopMC+Binance");
  const exInfo = await fetchJSON(`${BINANCE_SPOT}/api/v3/exchangeInfo`);
  const binanceUSDT = new Set(
    exInfo.symbols
      .filter(s => s.status === "TRADING" && s.quoteAsset === "USDT")
      .map(s => s.baseAsset.toUpperCase())
  );

  const markets = await fetchJSON(
    `${CG_BASE}/coins/markets?vs_currency=${encodeURIComponent("usd")}&order=market_cap_desc&per_page=60&page=1`
  );

  const list = [];
  for (const c of markets) {
    const base = (c.symbol || "").toUpperCase();
    if (binanceUSDT.has(base) && list.length < topn) {
      list.push({ id: c.id, symbol: base, name: c.name, image: c.image, market_cap: c.market_cap });
    }
  }
  dtimeEnd("TopMC+Binance");
  dlog("Top list", list.map(x => x.symbol));
  return list;
}


// OHLC diario desde Binance (1d)
async function fetchOHLC_Binance(symbolBase, days = 365) {
  const sym = `${symbolBase}USDT`;
  const limit = Math.min(Math.max(days, 2), 1000);
  const url = `${BINANCE_SPOT}/api/v3/klines?symbol=${sym}&interval=1d&limit=${limit}`;
  const label = `OHLC ${symbolBase} (${limit}d)`;
  dtime(label);
  const j = await fetchJSON(url);
  dtimeEnd(label);
  dlog("OHLC len", symbolBase, Array.isArray(j) ? j.length : 0);
  return j.map(k => [k[0], +k[1], +k[2], +k[3], +k[4]]);
}


// Globales simples (Fear&Greed) — gratis
async function fetchFNG() {
  dtime("FNG");
  try {
    const j = await fetchJSON(FNG_URL);
    const out = { value: Number(j?.data?.[0]?.value), label: j?.data?.[0]?.value_classification || "—" };
    dtimeEnd("FNG");
    dlog("FNG", out);
    return out;
  } catch {
    dtimeEnd("FNG");
    return { value: NaN, label: "—" };
  }
}

async function fetchNews() {
  dtime("News");
  const j = await fetchJSON(COINSTATS_NEWS);
  dtimeEnd("News");
  dlog("News items", j?.news?.length || 0);
  return j?.news || [];
}


// ===== Futuros (UMFutures) — solo señales contextuales =====
async function fetchFuturesMetrics(symbol) {
  const sym = `${symbol}USDT`;
  const out = { mark: NaN, funding8hPct: NaN, oiDeltaPct: NaN, lsRatio: NaN };
  const label = `Futures ${symbol}`;
  dtime(label);

  const prem = await fetchJSON(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`);
  if (!prem || prem.code) { dtimeEnd(label); dlog("No UMF listing", symbol); return out; }
  const lastFundingRate = Number(prem?.lastFundingRate ?? NaN);
  out.mark = Number(prem?.markPrice ?? NaN);
  out.funding8hPct = isFinite(lastFundingRate) ? lastFundingRate * 100 : NaN;

  const oi = await fetchJSON(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=1d&limit=2`);
  if (Array.isArray(oi) && oi.length >= 2) {
    const prev = Number(oi[0]?.sumOpenInterest || oi[0]?.sumOpenInterestValue || NaN);
    const last = Number(oi[1]?.sumOpenInterest || oi[1]?.sumOpenInterestValue || NaN);
    if (isFinite(prev) && isFinite(last) && prev !== 0) out.oiDeltaPct = ((last - prev) / prev) * 100;
  }

  const ls = await fetchJSON(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1h&limit=1`);
  if (Array.isArray(ls) && ls[0]?.longShortRatio) out.lsRatio = Number(ls[0].longShortRatio);

  dtimeEnd(label);
  dlog("Futures out", symbol, out);
  return out;
}


/* ===========================
   ===== Indicadores Tech =====
   =========================== */

function SMA(arr, p) { if (arr.length < p) return []; const out = []; let acc = sum(arr.slice(0, p)); out.push(acc / p); for (let i = p; i < arr.length; i++) { acc += arr[i] - arr[i - p]; out.push(acc / p); } return out; }
function EMA(arr, p) { const k = 2 / (p + 1); const out = []; let prev = mean(arr.slice(0, p)); out.push(prev); for (let i = p; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out.push(prev); } return out; }
function RSI(closes, p = 14) { if (closes.length < p + 1) return []; const gains = [], losses = []; for (let i = 1; i < closes.length; i++) { const ch = closes[i] - closes[i - 1]; gains.push(Math.max(0, ch)); losses.push(Math.max(0, -ch)); } let avgGain = mean(gains.slice(0, p)), avgLoss = mean(losses.slice(0, p)); const rsi = Array(p).fill(null); for (let i = p; i < gains.length; i++) { avgGain = (avgGain * (p - 1) + gains[i]) / p; avgLoss = (avgLoss * (p - 1) + losses[i]) / p; const rs = avgLoss === 0 ? 100 : avgGain / (avgLoss || 1e-9); rsi.push(100 - 100 / (1 + rs)); } return rsi; }
function MACD(closes, fast = 12, slow = 26, sig = 9) { if (closes.length < slow + sig) return { macd: [], signal: [], hist: [] }; const emaFast = EMA(closes, fast), emaSlow = EMA(closes, slow); const macd = []; const offs = emaSlow.length - emaFast.length; for (let i = 0; i < emaSlow.length; i++) { const f = emaFast[i - offs] ?? emaFast[0]; macd.push(f - emaSlow[i]); } const signal = EMA(macd, sig); const hist = signal.map((s, i) => macd[i + (macd.length - signal.length)] - s); const pad = closes.length - hist.length; return { macd: Array(pad).fill(null).concat(macd.slice(macd.length - hist.length)), signal: Array(pad).fill(null).concat(signal), hist: Array(pad).fill(null).concat(hist) }; }
function Bollinger(closes, p = 20, mult = 2) { if (closes.length < p) return { mid: [], upper: [], lower: [], posPct: [] }; const mid = SMA(closes, p); const upper = [], lower = [], posPct = []; for (let i = p - 1; i < closes.length; i++) { const win = closes.slice(i - p + 1, i + 1); const m = mid[i - (p - 1)], s = stdev(win); const up = m + mult * s, lo = m - mult * s; upper.push(up); lower.push(lo); const pos = clamp(((closes[i] - lo) / (up - lo)) * 100, 0, 100); posPct.push(pos); } const pad = closes.length - upper.length; return { mid: Array(pad).fill(null).concat(mid), upper: Array(pad).fill(null).concat(upper), lower: Array(pad).fill(null).concat(lower), posPct: Array(pad).fill(null).concat(posPct) }; }
function ATR(ohlc, p = 14) { if (ohlc.length < p + 1) return []; const TR = []; for (let i = 1; i < ohlc.length; i++) { const h = ohlc[i][2], l = ohlc[i][3], pc = ohlc[i - 1][4]; TR.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); } const atr = []; let prev = mean(TR.slice(0, p)); atr.push(prev); for (let i = p; i < TR.length; i++) { prev = (prev * (p - 1) + TR[i]) / p; atr.push(prev); } return Array(p).fill(null).concat(atr); }

/* ===========================
   ===== Señales & Score ======
   =========================== */

function scoreAndSignal(f) {
  let score = 0;
  if (f.rsi < 25) score += 1.1; else if (f.rsi < 35) score += 0.6; else if (f.rsi > 75) score -= 1.1; else if (f.rsi > 65) score -= 0.6;
  if (f.macdHist > 0 && f.macdSlope > 0) score += 1.0; else if (f.macdHist < 0 && f.macdSlope < 0) score -= 1.0;
  if (f.bbPos < 15) score += 0.6; if (f.bbPos > 85) score -= 0.6;
  score += f.aboveEMA200 ? 0.9 : -0.9;
  if (f.vsMA30 < -5) score += 0.35; if (f.vsMA30 > 7) score -= 0.35;
  if (f.distATH < -60) score += 0.2; if (f.distATH > -10) score -= 0.1;
  if (f.volAnn > 140) score -= 0.25;
  // Señales de Futuros (pesos chicos)
  if (isFinite(f.funding8hPct)) { if (f.funding8hPct > 0.05) score -= 0.15; if (f.funding8hPct < -0.02) score += 0.15; }
  if (isFinite(f.lsRatio)) { if (f.lsRatio > 1.2) score -= 0.15; if (f.lsRatio < 0.9) score += 0.15; }
  if (isFinite(f.oiDeltaPct) && isFinite(f.priceCh24h)) { if (f.oiDeltaPct > 3 && f.priceCh24h > 0) score += 0.2; if (f.oiDeltaPct > 3 && f.priceCh24h < 0) score -= 0.2; }

  const probUp = clamp(50 + score * 8, 0, 100);
  let signal = "HOLD";
  if (probUp >= 60 && f.aboveEMA200) signal = "BUY";
  else if (probUp <= 40 && !f.aboveEMA200) signal = "SELL";
  return { score: rnd(score, 2), probUp: rnd(probUp, 1), signal };
}

// === EXPLICACIÓN SIMPLE (pegaste esta versión en el turno anterior) ===
function explainDecision(ctx) {
  const { name, symbol, price, rsi, macdHist, macdSlope, atrPct, aboveEMA200, signal, probUp,
    funding8hPct, lsRatio, oiDeltaPct } = ctx;
  const tendencia = aboveEMA200 ? "🔵 Alcista (precio > EMA200)" :
    (aboveEMA200 === false ? "🔴 Bajista (precio < EMA200)" : "🔶 Indecisa");
  let momentum = "➖ Señales mixtas";
  if (macdHist != null && macdSlope != null) {
    if (macdHist > 0 && macdSlope > 0 && (rsi ?? 50) >= 45 && (rsi ?? 50) <= 70) momentum = "📈 Momentum positivo";
    else if (macdHist < 0 && macdSlope < 0 && (rsi ?? 50) >= 30 && (rsi ?? 50) <= 60) momentum = "📉 Momentum negativo";
  }
  if (isFinite(rsi)) {
    if (rsi < 30) momentum = "🟢 RSI sobreventa (rebote)";
    else if (rsi > 70) momentum = "🟠 RSI sobrecompra (cuidado)";
  }
  const futParts = [];
  if (isFinite(funding8hPct)) futParts.push(`Funding ${funding8hPct > 0 ? "positivo" : "negativo"} (${funding8hPct.toFixed(3)}%)`);
  if (isFinite(lsRatio)) futParts.push(`L/S ${lsRatio.toFixed(2)}${lsRatio > 1.2 ? " (crowded longs)" : lsRatio < 0.9 ? " (crowded shorts)" : ""}`);
  if (isFinite(oiDeltaPct)) futParts.push(`OI Δ ${oiDeltaPct.toFixed(1)}%`);
  const fut = "📊 " + (futParts.join(" | ") || "Futuros: neutro");
  const decision = signal === "BUY" ? "✅ Decisión: **Comprar** (parcial)"
    : signal === "SELL" ? "🚫 Decisión: **Vender / no entrar**"
      : "🕒 Decisión: **Mantener / esperar**";
  const plan = isFinite(atrPct) ? `SL≈ATR×mult | TP≈2×ATR | ATR~${atrPct.toFixed(2)}%` : "Gestión por ATR (no disp.)";
  const prob = isFinite(probUp) ? `Prob. de suba: ~${probUp}%` : "";
  const header = `**${name} (${symbol})** — Precio ${price}`;
  return [header, tendencia, momentum, fut, decision, prob, plan].filter(Boolean).join("\n");
}

// Explicación extendida por moneda (markdown)
function explainDecisionRich(r, vs, atrMult) {
  const fmt = fmtMoney(vs);
  const px_usd = r.price_usd;
  const atrPct = r.atrPct ?? NaN;
  const atrVal_usd = isFinite(atrPct) ? (atrPct * px_usd / 100) : NaN;

  const side = r.signal === "BUY" ? "BUY" : "SELL";
  const sl_usd = isFinite(atrVal_usd)
    ? (side === "BUY" ? px_usd - (atrMult * atrVal_usd) : px_usd + (atrMult * atrVal_usd))
    : NaN;
  const tp_usd = isFinite(atrVal_usd)
    ? (side === "BUY" ? px_usd + (2 * atrMult * atrVal_usd) : px_usd - (2 * atrMult * atrVal_usd))
    : NaN;

  const px_vs = fxConv(px_usd, vs);
  const sl_vs = fxConv(sl_usd, vs);
  const tp_vs = fxConv(tp_usd, vs);

  const head = `**${r.name} (${r.symbol})** — Precio ${fmt.format(px_vs)} · Señal: **${r.signal}** (Prob.↑ ~${isFinite(r.probUp) ? r.probUp.toFixed(0) : "—"}%)`;

  const tendencia = r.aboveEMA200 ? "🔵 Alcista (> EMA200)" : "🔴 Bajista (< EMA200)";
  const vsMA30 = isFinite(r.vsMA30) ? `${r.vsMA30.toFixed(1)}%` : "—";
  const rsiTxt = isFinite(r.rsi) ? r.rsi.toFixed(1) : "—";
  const macdTxt = (isFinite(r.macdHist) ? r.macdHist.toFixed(3) : "—") + (isFinite(r.macdSlope) ? ` (Δ ${r.macdSlope >= 0 ? "↑" : "↓"})` : "");
  const bbTxt = isFinite(r.bbPos) ? `${r.bbPos.toFixed(0)}%` : "—";
  const volTxt = isFinite(r.volAnn) ? `${r.volAnn.toFixed(0)}%` : "—";
  const atrTxt = isFinite(atrPct) ? `${atrPct.toFixed(2)}%` : "—";
  const distATHTxt = isFinite(r.distATH) ? `${r.distATH.toFixed(0)}%` : "—";
  const perf52wTxt = isFinite(r.perf52w) ? `${r.perf52w.toFixed(0)}%` : "—";

  const futBits = [];
  if (isFinite(r.funding8hPct)) futBits.push(`Funding ${r.funding8hPct > 0 ? "+" : "-"} ${r.funding8hPct.toFixed(3)}%`);
  if (isFinite(r.lsRatio)) futBits.push(`L/S ${r.lsRatio.toFixed(2)}${r.lsRatio > 1.2 ? " (crowded longs)" : r.lsRatio < 0.9 ? " (crowded shorts)" : ""}`);
  if (isFinite(r.oiDeltaPct)) futBits.push(`OIΔ ${r.oiDeltaPct.toFixed(1)}%`);
  const futTxt = futBits.length ? futBits.join(" · ") : "Neutro";

  const plan = isFinite(sl_usd) && isFinite(tp_usd)
    ? `**Plan educativo** · Tipo: ${(r.bbPos < 25 && side === "BUY") ? "LIMIT" : "MARKET"}  
SL≈ ${fmt.format(sl_vs)} · TP≈ ${fmt.format(tp_vs)} · ATR×mult=${atrMult} (${atrTxt})`
    : "**Plan educativo** · Gestión por ATR (no disponible)";

  const checklist = [
    r.aboveEMA200 ? "Tendencia a favor" : "Tendencia en contra",
    (isFinite(r.macdHist) && isFinite(r.macdSlope) && r.macdHist > 0 && r.macdSlope > 0) ? "MACD hist>0 y subiendo" :
      (isFinite(r.macdHist) && isFinite(r.macdSlope) && r.macdHist < 0 && r.macdSlope < 0) ? "MACD hist<0 y cayendo" : "Momentum mixto",
    isFinite(r.rsi) ? (r.rsi < 30 ? "RSI sobreventa (rebote)" : r.rsi > 70 ? "RSI sobrecompra (cuidado)" : "RSI neutral") : "RSI —",
    isFinite(r.bbPos) ? `BB pos: ${bbTxt}` : "BB —",
    isFinite(r.volAnn) ? `Vol 30d: ${volTxt}` : "Vol —",
    `Futuros: ${futTxt}`,
  ].map(x => `- ${x}`).join("\n");

  const why = r.signal === "BUY"
    ? "Se pondera entrada cuando tendencia y momentum acompañan o hay rebote técnico con riesgo acotado por ATR."
    : r.signal === "SELL"
      ? "Evitar entradas: tendencia débil/negativa o momentum a la baja; proteger ganancias si estás dentro."
      : "Señales mixtas; esperar confirmación (tendencia/momentum) o mejor setup de riesgo.";

  return [
    head,
    "",
    "### 📌 Resumen",
    `- ${tendencia} · vs MA30: ${vsMA30}`,
    `- RSI: ${rsiTxt} · MACD: ${macdTxt} · BB pos: ${bbTxt}`,
    `- 52W: ${perf52wTxt} · Dist ATH: ${distATHTxt}`,
    "",
    "### 📊 Futuros (contexto ultracorto)",
    futTxt,
    "",
    "### 🧭 Plan",
    plan,
    "",
    "### ✅ Check-list",
    checklist,
    "",
    `> ${why}`
  ].join("\n");
}


// Explicación basada en métricas reales (razón corta)
function buildShortReason(r, vs) {
  const fmt = fmtMoney(vs);
  const precio = fmt.format(r.price_vs);

  // Tendencia
  const tend = r.aboveEMA200 ? "Alcista (precio > EMA200)" : "Bajista (precio < EMA200)";

  // Momentum (MACD + RSI)
  let mom = "Mixto";
  if (isFinite(r.macdHist) && isFinite(r.macdSlope)) {
    if (r.macdHist > 0 && r.macdSlope > 0) mom = "Momentum positivo (MACD↑)";
    if (r.macdHist < 0 && r.macdSlope < 0) mom = "Momentum negativo (MACD↓)";
  }
  if (isFinite(r.rsi)) {
    if (r.rsi < 30) mom = "Sobreventa (RSI<30) → rebote posible";
    else if (r.rsi > 70) mom = "Sobrecompra (RSI>70) → riesgo de toma de ganancias";
  }

  // Fututos (ultra corto)
  let fut = "Neutro";
  const fBits = [];
  if (isFinite(r.funding8hPct)) {
    fBits.push(`Funding ${r.funding8hPct > 0 ? "+" : "-"} ${r.funding8hPct.toFixed(3)}%`);
  }
  if (isFinite(r.lsRatio)) fBits.push(`L/S ${rnd(r.lsRatio, 2)}`);
  if (isFinite(r.oiDeltaPct)) fBits.push(`OIΔ ${rnd(r.oiDeltaPct, 1)}%`);
  if (fBits.length) fut = fBits.join(" · ");

  // Decisión (misma lógica del score)
  const decision = r.signal === "BUY" ? "Comprar"
    : r.signal === "SELL" ? "Vender / no entrar"
      : "Hold / esperar";

  // Razón textual: por qué sugiere eso
  let because = "";
  if (r.signal === "BUY") {
    because = r.aboveEMA200
      ? "Tendencia general favorable y momentum acompañando; riesgo controlable vía ATR."
      : "Señales de rebote (RSI/BB) aun con tendencia débil; posición educativa y parcial.";
    if (r.funding8hPct > 0.05 || r.lsRatio > 1.2) {
      because += " Ojo: crowd long (funding/L-S) → evitar euforia.";
    }
  } else if (r.signal === "SELL") {
    because = !r.aboveEMA200
      ? "Tendencia bajista con momentum débil; evitar entradas nuevas."
      : "Extensión de precio y/o momentum negativo; mejor proteger ganancias.";
    if (r.oiDeltaPct > 3 && r.price_change_24h < 0) {
      because += " OI subiendo con precio cayendo → presión vendedora.";
    }
  } else {
    because = "Señales mixtas; esperar confirmación de tendencia o alivio en funding/L-S.";
  }

  const prob = isFinite(r.probUp) ? `Prob.↑ ~${r.probUp.toFixed(0)}%` : "";

  return {
    headTitle: `${r.name} (${r.symbol}) — ${precio}`,
    decision,
    tend, mom, fut, prob,
    metrics: {
      RSI: isFinite(r.rsi) ? r.rsi.toFixed(1) : "—",
      "MACD hist": isFinite(r.macdHist) ? r.macdHist.toFixed(3) : "—",
      "vs MA30": isFinite(r.vsMA30) ? `${r.vsMA30.toFixed(1)}%` : "—",
      "ATR%": isFinite(r.atrPct) ? `${r.atrPct.toFixed(2)}%` : "—",
      "Funding": isFinite(r.funding8hPct) ? `${r.funding8hPct.toFixed(3)}%` : "—",
      "L/S": isFinite(r.lsRatio) ? r.lsRatio.toFixed(2) : "—",
      "OIΔ": isFinite(r.oiDeltaPct) ? `${r.oiDeltaPct.toFixed(1)}%` : "—"
    },
    because
  };
}

function renderEduList(rows, vs, atrMult = Number(document.querySelector("#atrMult")?.value || 1.5)) {


  const wrap = document.querySelector("#eduList");
  if (!wrap) return;
  wrap.innerHTML = "";
  rows.slice(0, 10).forEach(r => {
    const info = buildShortReason(r, vs);
    const item = document.createElement("div");
    item.className = "edu-item";

    const badgeClass = r.signal === 'BUY' ? 'edu-badge buy' : r.signal === 'SELL' ? 'edu-badge sell' : 'edu-badge hold';
    const badgeText = r.signal === 'BUY' ? 'Comprar' : r.signal === 'SELL' ? 'Vender/No entrar' : 'Hold/Esperar';

    // métrica key-values (columna derecha)
    const kv = Object.entries(info.metrics).map(([k, v]) =>
      `<div class="edu-kv"><span class="k">${k}</span><span class="v">${escapeHtml(v)}</span></div>`
    ).join("");

    item.innerHTML = `
      <div class="edu-head">
        <div class="edu-title">${escapeHtml(info.headTitle)}</div>
        <span class="${badgeClass}">${badgeText}</span>
      </div>
      <div class="edu-grid">
        <div class="edu-left">
          <span class="edu-pill">${escapeHtml(info.tend)}</span>
          <span class="edu-pill">${escapeHtml(info.mom)}</span>
          <span class="edu-pill">${escapeHtml(info.fut)}</span>
          <div class="small-muted mt-2">${escapeHtml(info.prob)}</div>
          <div class="mt-2">${escapeHtml(info.because)}</div>
        </div>
        <div class="edu-right">${kv}</div>
      </div>
        <div class="mt-2">
      <button class="btn btn-sm btn-outline-light" data-action="explain" data-idx="${rows.indexOf(r)}">Ver más</button>
    </div>
    `;
    wrap.querySelectorAll('button[data-action="explain"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        const i = Number(e.currentTarget.dataset.idx);
        const r = rows[i];
        const modalBody = document.querySelector("#exampleContent");
        if (!modalBody) return;
        modalBody.innerHTML = mdToHtml(explainDecisionRich(r, vs, atrMult));
        const modalEl = document.querySelector("#exampleModal");
        if (modalEl && window.bootstrap?.Modal) new window.bootstrap.Modal(modalEl).show();
      });
    });

  });
}




/* ===========================
   ===== UI: Tablas/Render ====
   =========================== */

function renderContext({ capTxt, btcDomTxt, volRegime, fng }) {
  $("#mktCap").textContent = capTxt || "—";
  $("#btcDom").textContent = btcDomTxt || "—";
  $("#volReg").textContent = volRegime || "—";
  $("#fng").textContent = isFinite(fng?.value) ? `${fng.value} (${fng.label})` : "—";
}

function renderSignalsTable(rows, vs) {
  const table = document.querySelector("#signalsTable");
  if (!table) return; // si no existe la tabla, no renderizamos
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const fmt = fmtMoney(vs);
  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img src="${r.image}" width="18" height="18" class="me-1 rounded-circle" alt="${r.symbol}"> <strong>${r.name}</strong> <span class="badge badge-chip ms-1">${r.symbol}</span></td>
      <td class="text-end">${fmt.format(r.price_vs)}</td>
      <td class="text-end ${r.rsi < 30 ? 'text-up' : r.rsi > 70 ? 'text-dn' : ''}">${isFinite(r.rsi) ? r.rsi.toFixed(1) : '—'}</td>
      <td class="text-end ${r.macdHist > 0 ? 'text-up' : r.macdHist < 0 ? 'text-dn' : ''}">${isFinite(r.macdHist) ? r.macdHist.toFixed(3) : '—'}</td>
      <td class="text-end">${isFinite(r.bbPos) ? r.bbPos.toFixed(0) + '%' : '—'}</td>
      <td class="text-end">${isFinite(r.volAnn) ? r.volAnn.toFixed(0) + '%' : '—'}</td>
      <td class="text-end">${isFinite(r.atrPct) ? r.atrPct.toFixed(2) + '%' : '—'}</td>
      <td class="text-end ${r.vsMA30 < 0 ? 'text-up' : 'text-dn'}">${isFinite(r.vsMA30) ? r.vsMA30.toFixed(1) + '%' : '—'}</td>
      <td class="text-end ${r.aboveEMA200 ? 'text-up' : 'text-dn'}">${r.aboveEMA200 ? '↑' : '↓'}</td>
      <td class="text-end">${isFinite(r.distATH) ? r.distATH.toFixed(0) + '%' : '—'}</td>
      <td class="text-end ${r.perf52w >= 0 ? 'text-up' : 'text-dn'}">${isFinite(r.perf52w) ? r.perf52w.toFixed(0) + '%' : '—'}</td>
      <td class="text-end ${r.funding8hPct > 0.05 ? 'text-dn' : r.funding8hPct < -0.02 ? 'text-up' : ''}">${isFinite(r.funding8hPct) ? r.funding8hPct.toFixed(3) + '%' : '—'}</td>
      <td class="text-end ${r.lsRatio > 1.2 ? 'text-dn' : r.lsRatio < 0.9 ? 'text-up' : ''}">${isFinite(r.lsRatio) ? r.lsRatio.toFixed(2) : '—'}</td>
      <td class="text-end ${r.oiDeltaPct > 3 && r.price_change_24h > 0 ? 'text-up' : r.oiDeltaPct > 3 && r.price_change_24h < 0 ? 'text-dn' : ''}">${isFinite(r.oiDeltaPct) ? r.oiDeltaPct.toFixed(1) + '%' : '—'}</td>
      <td class="text-end">${isFinite(r.probUp) ? r.probUp.toFixed(0) + '%' : '—'}</td>
      <td>
        <span class="badge ${r.signal === 'BUY' ? 'pill-buy' : r.signal === 'SELL' ? 'pill-sell' : 'badge-chip'}">${r.signal}</span>
        <button class="btn btn-sm btn-outline-light ms-2" data-action="explain" data-idx="${idx}"><i class="bi bi-info-circle"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button[data-action="explain"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.currentTarget.dataset.idx);
      const r = rows[i];
      const vsSel = (document.querySelector("#vs")?.value || "usd").toLowerCase();
      const atrMult = Number(document.querySelector("#atrMult")?.value || 1.5);

      const modalBody = document.querySelector("#exampleContent");
      if (!modalBody) return;
      modalBody.innerHTML = mdToHtml(explainDecisionRich(r, vsSel, atrMult));

      const modalEl = document.querySelector("#exampleModal");
      if (modalEl && window.bootstrap?.Modal) new window.bootstrap.Modal(modalEl).show();
    });
  });

}

function renderOrdersTable(orders, vs) {
  const table = document.querySelector("#ordersTable");
  if (!table) return; // si no hay tabla de órdenes, salimos
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const fmt = fmtMoney(vs);
  orders.forEach((o, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${o.symbol}/USDT</strong></td>
      <td><span class="badge ${o.side === 'BUY' ? 'pill-buy' : 'pill-sell'}">${o.side}</span></td>
      <td>${o.type}</td>
      <td class="text-end">${fmt.format(o.price_vs)}</td>
      <td class="text-end">${fmt.format(o.sl_vs)}</td>
      <td class="text-end">${fmt.format(o.tp_vs)}</td>
      <td class="text-end">${fmt.format(o.size_vs)}</td>
      <td><button class="btn btn-sm btn-outline-light" data-action="why" data-id="${o.id}"><i class="bi bi-search"></i></button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button[data-action="why"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.id;
      const o = orders.find(x => x.id === id);
      const modalBody = document.querySelector("#exampleContent");
      if (!modalBody) return;
      modalBody.innerHTML = mdToHtml(o?.explain || "Sin explicación.");
      const modalEl = document.querySelector("#exampleModal");
      if (modalEl && $w.bootstrap?.Modal) new $w.bootstrap.Modal(modalEl).show();

    });
  });
}


function renderNews(list) {
  const wrap = $("#cryptoNewsList");
  if (!wrap) return;
  wrap.innerHTML = "";
  list.slice(0, 12).forEach(n => {
    const a = document.createElement("a");
    a.className = "list-group-item list-group-item-action";
    a.target = "_blank"; a.rel = "noopener";
    a.href = n.link || n.sourceLink || n.guid || "#";
    a.innerHTML = `
      <div class="d-flex w-100 justify-content-between">
        <h6 class="mb-1">${escapeHtml(n.title || "Noticia")}</h6>
        <small class="text-muted">${escapeHtml(n.source || n.feed || "")}</small>
      </div>
      <p class="mb-1 small">${escapeHtml(n.description || "").slice(0, 180)}...</p>
      <small class="text-muted">${new Date(n.feedDate || n.pubDate || Date.now()).toLocaleString()}</small>
    `;
    wrap.appendChild(a);
  });
}

/* ===========================
   ======= Backtesting ========
   =========================== */

let equityChart = null;
function initEquityChart() {
  const ctx = $("#equityCanvas")?.getContext("2d");
  if (!ctx || !$w.Chart) { dlog("Chart no disponible todavía"); return; }
  equityChart = new $w.Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [{ label: "Equity", data: [] }] },
    options: { responsive: true, animation: false, scales: { y: { ticks: { callback: (v) => `${(v * 100).toFixed(0)}%` } } } }
  });
}

function updateEquityChart(series) {
  if (!equityChart) initEquityChart();
  if (!equityChart) return;
  equityChart.data.labels = series.map((_, i) => i.toString());
  equityChart.data.datasets[0].data = series;
  equityChart.update();
}
function maxDrawdown(series) { let peak = series[0] || 1, mdd = 0; for (const v of series) { if (v > peak) peak = v; const dd = (peak - v) / peak; if (dd > mdd) mdd = dd; } return mdd; }
function backtestOne(ohlc, strategy, { hold = 7, slx = 1.5, tpx = 3 }) {
  const closes = ohlc.map(x => x[4]), ema200 = EMA(closes, 200), ma30 = SMA(closes, 30);
  const { hist } = MACD(closes, 12, 26, 9), rsi = RSI(closes, 14), bb = Bollinger(closes, 20, 2), atr = ATR(ohlc, 14);
  const trades = []; let i = Math.max(200, 30, 20, 14) + 1;
  while (i < closes.length - 1) {
    const c = closes[i], h = hist[i] ?? null, r = rsi[i] ?? null, bbPos = bb.posPct[i] ?? null, atrVal = atr[i] ?? null;
    let entry = false;
    if (strategy === "momentum") entry = (c > (ma30[i] ?? Infinity)) && (h > 0) && (r > 50) && (c > (ema200[i] || 0));
    else entry = (r < 30) && (bbPos !== null && bbPos < 25);
    if (entry && atrVal && isFinite(atrVal)) {
      const px = c, sl = px * (1 - slx * atrVal / px), tp = px * (1 + tpx * atrVal / px);
      let exitIdx = Math.min(i + hold, closes.length - 1), exitPx = closes[exitIdx], outcome = (exitPx - px) / px;
      for (let j = i + 1; j <= exitIdx; j++) { const hi = ohlc[j][2], lo = ohlc[j][3]; if (lo <= sl) { exitIdx = j; exitPx = sl; outcome = (sl - px) / px; break; } if (hi >= tp) { exitIdx = j; exitPx = tp; outcome = (tp - px) / px; break; } }
      trades.push({ entryIdx: i, exitIdx, entry: px, exit: exitPx, ret: outcome }); i = exitIdx + 1;
    } else i++;
  }
  return trades;
}
function splitTrainTest(length, wf = 0.7) { const split = Math.floor(length * wf); return { trainEnd: split - 1, testStart: split }; }
function portfolioEquityFromTrades(trades, length, allocPerTrade = 1) { let eq = 1; const series = Array(length).fill(null); let idx = 0; for (let i = 0; i < length; i++) { series[i] = eq; while (idx < trades.length && trades[idx].exitIdx === i) { eq *= (1 + trades[idx].ret * allocPerTrade); idx++; } } return series.map(v => v ?? eq); }
function summarizeTrades(trades, start = 0, end = Infinity) { const sel = trades.filter(t => t.exitIdx >= start && t.exitIdx <= end); const n = sel.length; if (!n) return { n, winPct: 0, avg: 0, total: 0, hit: 0 }; const rets = sel.map(t => t.ret); return { n, winPct: (100 * rets.filter(r => r > 0).length) / n, avg: 100 * mean(rets), total: 100 * (rets.reduce((a, b) => a + b, 0)), hit: mean(rets.map(r => (r > 0 ? 1 : 0))) }; }

/* ===========================
   ======= Orquestación =======
   =========================== */

async function runAnalysis() {
  const vs = ($("#vs").value || "usd").toLowerCase();
  const strategy = $("#strategy").value || "momentum";
  const topn = Number($("#topn").value || 20);
  const size_vs = Number($("#size").value || 100);
  const atrMult = Number($("#atrMult").value || 1.5);

  dlog("runAnalysis start", { vs, strategy, topn, size_vs, atrMult });

  $("#runBtn").disabled = true;
  $("#runBtn").innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Analizando…`;

  try {
    dtime("Context+FX");
    await ensureFX();

    let volRegime = "—";
    try {
      const btcOHLC = await fetchOHLC_Binance("BTC", 60);
      const btcCloses = btcOHLC.map(x => x[4]);
      const last30 = btcCloses.slice(-31);
      const volAnn = stdev(logret(last30)) * Math.sqrt(365) * 100;
      volRegime = volAnn < 60 ? "Baja" : volAnn < 100 ? "Media" : "Alta";
    } catch { }
    const fng = await fetchFNG();
    renderContext({ capTxt: "—", btcDomTxt: "—", volRegime, fng });
    dtimeEnd("Context+FX");

    dtime("Top list");
    const coins = await fetchTopMarketCapOnBinance({ vs: "usd", topn });
    dtimeEnd("Top list");

    const rows = [];
    for (const c of coins) {
      const lbl = `coin ${c.symbol}`;
      dtime(lbl);
      try {
        const ohlc = await fetchOHLC_Binance(c.symbol, 365);
        if (!Array.isArray(ohlc) || ohlc.length < 60) { dlog("skip (OHLC short)", c.symbol); dtimeEnd(lbl); continue; }
        // === (TU MISMO CÓDIGO DE CÁLCULO AQUÍ, NO CAMBIA) ===
        const closes = ohlc.map(x => x[4]);
        const last = closes.length - 1;
        const price_usd = closes[last];
        const ema200 = EMA(closes, 200);
        const ma30 = SMA(closes, 30);
        const { hist } = MACD(closes, 12, 26, 9);
        const rsi = RSI(closes, 14);
        const bb = Bollinger(closes, 20, 2);
        const atr = ATR(ohlc, 14);
        const rsiL = rsi[last] ?? NaN;
        const histL = hist[last] ?? NaN;
        const histPrev = hist[last - 1] ?? histL;
        const macdSlope = isFinite(histL) && isFinite(histPrev) ? histL - histPrev : NaN;
        const bbPos = bb.posPct[last] ?? NaN;
        const volAnn = stdev(logret(closes.slice(-31))) * Math.sqrt(365) * 100;
        const atrPct = (atr[last] ?? NaN) / price_usd * 100;
        const vsMA30 = ((price_usd - (ma30[last] ?? price_usd)) / (ma30[last] || price_usd)) * 100;
        const aboveEMA200 = price_usd > (ema200[last] ?? Infinity);
        const yearSlice = closes.slice(-365);
        const perf52w = yearSlice.length > 1 ? (price_usd / yearSlice[0] - 1) * 100 : NaN;
        const ath = Math.max(...closes);
        const distATH = (price_usd / ath - 1) * 100;
        const price_change_24h = closes[last - 1] ? ((price_usd / closes[last - 1]) - 1) * 100 : NaN;

        const fut = await fetchFuturesMetrics(c.symbol);
        const { funding8hPct, lsRatio } = fut;

        const { score, probUp, signal } = scoreAndSignal({
          rsi: rsiL, macdHist: histL, macdSlope, bbPos, volAnn, atrPct,
          vsMA30, aboveEMA200, distATH, perf52w, priceCh24h: price_change_24h,
          funding8hPct, lsRatio, oiDeltaPct: fut.oiDeltaPct
        });

        const price_vs = fxConv(price_usd, vs);
        const fmt = fmtMoney(vs);
        const explain = explainDecision({
          name: c.name, symbol: c.symbol, price: fmt.format(price_vs),
          rsi: rsiL, macdHist: histL, macdSlope, bbPos,
          volAnn, atrPct, vsMA30, aboveEMA200, distATH, perf52w,
          signal, probUp, funding8hPct, lsRatio, oiDeltaPct: fut.oiDeltaPct
        });

        rows.push({
          ...c,
          image: c.image,
          price_usd, price_vs,
          rsi: rsiL, macdHist: histL, macdSlope, bbPos,
          volAnn, atrPct, vsMA30, aboveEMA200, distATH, perf52w,
          price_change_24h,
          funding8hPct, lsRatio, oiDeltaPct: fut.oiDeltaPct,
          score, probUp, signal,
          explain,
          ohlc, closes, ema200, ma30, atr
        });
        dlog("row", c.symbol, { score, signal, probUp });
      } catch (e) {
        dlog("Error moneda", c.id, e);
      } finally {
        dtimeEnd(lbl);
      }
    }

    rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    dlog("rows ready", rows.length);

    renderSignalsTable(rows, vs);
    renderEduList(rows, vs, atrMult);


    // Órdenes (como ya tenías)
    const orders = [];
    const want = 10;
    function mkOrder(r) {
      const px_usd = r.price_usd;
      const atrVal_usd = r.atrPct * px_usd / 100;
      const side = r.signal === "BUY" ? "BUY" : "SELL";
      const sl_usd = side === "BUY" ? px_usd - (atrMult * atrVal_usd) : px_usd + (atrMult * atrVal_usd);
      const tp_usd = side === "BUY" ? px_usd + (2 * atrMult * atrVal_usd) : px_usd - (2 * atrMult * atrVal_usd);
      const type = (r.bbPos < 25 && side === "BUY") ? "LIMIT" : "MARKET";
      const px_vs = fxConv(px_usd, vs);
      const sl_vs = fxConv(sl_usd, vs);
      const tp_vs = fxConv(tp_usd, vs);
      return { id: `${r.symbol}-${Date.now()}`, symbol: r.symbol, side, type, price_usd: px_usd, sl_usd, tp_usd, price_vs: px_vs, sl_vs, tp_vs, size_vs: size_vs, explain: r.explain };
    }
    rows.filter(r => r.signal === "BUY").slice(0, want).forEach(r => orders.push(mkOrder(r)));
    if (orders.length < want) rows.filter(r => r.signal === "SELL").slice(0, want - orders.length).forEach(r => orders.push(mkOrder(r)));
    dlog("orders prepared", orders.length);

    renderOrdersTable(orders, vs);

    // Ejemplo top
    if (rows[0]) {
      const fmt = fmtMoney(vs);
      $("#exampleContent").innerHTML = mdToHtml(explainDecision({
        name: rows[0].name, symbol: rows[0].symbol, price: fmt.format(rows[0].price_vs),
        rsi: rows[0].rsi, macdHist: rows[0].macdHist, macdSlope: rows[0].macdSlope, bbPos: rows[0].bbPos,
        volAnn: rows[0].volAnn, atrPct: rows[0].atrPct, vsMA30: rows[0].vsMA30, aboveEMA200: rows[0].aboveEMA200,
        distATH: rows[0].distATH, perf52w: rows[0].perf52w, signal: rows[0].signal, probUp: rows[0].probUp,
        funding8hPct: rows[0].funding8hPct, lsRatio: rows[0].lsRatio, oiDeltaPct: rows[0].oiDeltaPct
      }));
    }

    // Noticias
    try { const news = await fetchNews(); renderNews(news); } catch { }
    window.__CBP_LAST__ = { when: nowTs(), vs, strategy, topn, size_vs, atrMult, rows, orders, context: { volRegime, fng } };
    dlog("runAnalysis done");
    $("#runBtn").innerHTML = `<i class="bi bi-cpu me-1"></i> Re-analizar`;
  } catch (e) {
    console.error(e);
    alert("Error en el análisis (fuentes públicas). Probá nuevamente.");
  } finally {
    $("#runBtn").disabled = false;
  }
}


/* ===========================
   ======= Paper trading ======
   =========================== */

const LS_ORDERS = "cbp_paper_orders_v1";
function loadPaper() { try { return JSON.parse(localStorage.getItem(LS_ORDERS) || "[]"); } catch { return []; } }
function savePaper(arr) { localStorage.setItem(LS_ORDERS, JSON.stringify(arr)); }
function placeAllOrders() { const cur = loadPaper(); const toAdd = (window.__CBP_LAST__?.orders || []).map(o => ({ ...o, ts: Date.now() })); const out = [...toAdd, ...cur].slice(0, 200); savePaper(out); alert(`Guardadas ${toAdd.length} órdenes (paper) en tu navegador.`); }
function clearPaper() { savePaper([]); alert("Órdenes (paper) borradas."); }

/* ===========================
   ========= Export / BT ======
   =========================== */

function exportJSON() { const data = window.__CBP_LAST__ || { error: "No hay datos. Corré el análisis." }; downloadJSON(`cripto-signals-${Date.now()}.json`, data); }

function initEquityChartWrapper() { const ctx = $("#equityCanvas"); if (ctx && !equityChart) initEquityChart(); }
function runBacktest() {
  const lookback = Number($("#btLookback").value || 300);
  const hold = Number($("#btHold").value || 7);
  const slx = Number($("#btSLx").value || 1.5);
  const tpx = Number($("#btTPx").value || 3);
  const wf = Number($("#btWF").value || 70) / 100;
  const strategy = $("#strategy").value || "momentum";

  const rows = (window.__CBP_LAST__?.rows || []).slice(0, 25);
  if (!rows.length) return alert("Corré el análisis primero.");

  const results = [];
  let longest = 0;
  rows.forEach(r => {
    const o = r.ohlc.slice(-lookback);
    longest = Math.max(longest, o.length);
    const trades = backtestOne(o, strategy, { hold, slx, tpx });
    results.push({ symbol: r.symbol, trades, len: o.length });
  });

  const { trainEnd, testStart } = splitTrainTest(longest, wf);
  const tbody = $("#btTable tbody"); if (tbody) tbody.innerHTML = "";
  let portfolioTrades = [];
  results.forEach(res => {
    const trAll = res.trades;
    const trTrain = trAll.filter(t => t.exitIdx <= trainEnd);
    const trTest = trAll.filter(t => t.exitIdx >= testStart);
    portfolioTrades = portfolioTrades.concat(trTest);

    if (tbody) {
      const sTR = summarizeTrades(trTrain, 0, trainEnd);
      const sTS = summarizeTrades(trTest, testStart, Infinity);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${res.symbol}</strong></td>
        <td class="text-end">${rnd(sTR.n, 0)}/${rnd(sTS.n, 0)}</td>
        <td class="text-end">${rnd(sTR.winPct, 0)}% / ${rnd(sTS.winPct, 0)}%</td>
        <td class="text-end">${rnd(sTR.avg, 2)}% / ${rnd(sTS.avg, 2)}%</td>
        <td class="text-end">${rnd(sTR.total, 1)}% / ${rnd(sTS.total, 1)}%</td>
      `;
      tbody.appendChild(tr);
    }
  });

  const eq = portfolioEquityFromTrades(portfolioTrades.sort((a, b) => a.exitIdx - b.exitIdx), longest);
  updateEquityChart(eq);

  const retsDaily = eq.slice(1).map((x, i) => (x / eq[i] - 1));
  const vol = stdev(retsDaily) * Math.sqrt(365);
  const sharpe = (mean(retsDaily) * 365) / (stdev(retsDaily) || 1e-9);
  const mdd = maxDrawdown(eq);
  const calmar = ((eq[eq.length - 1] - 1) / (mdd || 1e-9));
  const posDays = retsDaily.filter(r => r > 0).length / Math.max(1, retsDaily.length);

  $("#mSharpe").textContent = isFinite(sharpe) ? rnd(sharpe, 2) : "—";
  $("#mVol").textContent = isFinite(vol) ? pct(vol * 100, 0) : "—";
  $("#mMDD").textContent = isFinite(mdd) ? pct(mdd * 100, 0) : "—";
  $("#mCalmar").textContent = isFinite(calmar) ? rnd(calmar, 2) : "—";
  $("#mPosDays").textContent = pct(posDays * 100, 0);
  $("#mHit").textContent = pct(mean(portfolioTrades.map(t => t.ret > 0 ? 1 : 0)) * 100, 0);

  $("#btSummary").innerHTML = `<div class="small-muted"><strong>Notas:</strong> Simulación educativa, aproximación diaria (OHLC). Costos no neteados finamente. TRAIN=${Math.round(wf * 100)}% / TEST=${Math.round(100 - wf * 100)}%.</div>`;
}

/* ===========================
   ========= Eventos ==========
   =========================== */

function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

function bindUI() {
  dlog("bindUI");
  const runBtn = document.querySelector("#runBtn");
  const exportBtn = document.querySelector("#exportBtn");
  const exampleBtn = document.querySelector("#exampleBtn");
  const placeAllBtn = document.querySelector("#placeAll");
  const clearBtn = document.querySelector("#clearBtn");
  const refreshNewsBtn = document.querySelector("#refreshNews");
  const runBtBtn = document.querySelector("#runBt");

  on(runBtn, "click", runAnalysis);
  on(exportBtn, "click", exportJSON);
  on(exampleBtn, "click", () => {
    if (!window.__CBP_LAST__?.rows?.length) { alert("Corré el análisis primero."); return; }
    const r = window.__CBP_LAST__.rows[0];
    const vsSel = (document.querySelector("#vs")?.value || "usd").toLowerCase();
    const atrMult = Number(document.querySelector("#atrMult")?.value || 1.5);
    document.querySelector("#exampleContent").innerHTML = mdToHtml(explainDecisionRich(r, vsSel, atrMult));
    if (window.bootstrap?.Modal) new window.bootstrap.Modal(document.querySelector("#exampleModal")).show();
  });

  on(placeAllBtn, "click", placeAllOrders);
  on(clearBtn, "click", clearPaper);
  on(refreshNewsBtn, "click", async () => { try { const news = await fetchNews(); renderNews(news); } catch { } });
  on(runBtBtn, "click", runBacktest);
}


function start() {
  if ($w.__CBP_INITED__) { dlog("start() omitido (ya inicializado)"); return; }
  $w.__CBP_INITED__ = true;
  dlog("start()");
  bindUI();
  initEquityChartWrapper();

  // Auto-ejecutar análisis al cargar (opcional):
  // runAnalysis();
}

// Si el DOM ya está listo (como pasa cuando inyectamos el script desde React),
// arrancamos igual. Si no, esperamos a DOMContentLoaded.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

