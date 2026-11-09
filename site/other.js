/* "Other investments": things with no live price in this app (Endowus funds and portfolios, CPF, SRS, bank products).
   The user records what each is worth; the app keeps a dated history, estimates today's value from a stand-in index
   (an index ETF the fund tracks), and counts the money in the asset split. Pure logic, no DOM, no network.

   The estimate is deliberately labelled as rough: a stand-in index is not the fund (fees, currency, hedging and
   rebalancing differ), so the real value is always the number in the provider's own app. */
(function (root) {
  "use strict";

  const CURRENCIES = ["SGD", "USD"];
  const MAX_ITEMS = 50, MAX_HISTORY = 400, STALE_DAYS = 30, VERY_STALE_DAYS = 90;
  const CLASSES = ["equity", "bond", "cash", "other"];

  /* Starting points for the funds this user holds on Endowus. Mixes and stand-ins are approximations. */
  const PRESETS = [
    { key: "us500", name: "iShares US Index Fund (IE) S&P 500", platform: "Endowus (Fund Smart)", mix: { equity: 1 }, proxy: { SPY: 1 }, note: "Stand-in: SPY (S&P 500)" },
    { key: "em", name: "Amundi Core MSCI Emerging Markets Fund", platform: "Endowus (Fund Smart)", mix: { equity: 1 }, proxy: { EEM: 1 }, note: "Stand-in: EEM (MSCI Emerging Markets)" },
    { key: "world", name: "iShares Developed World Index Fund (IE)", platform: "Endowus (Fund Smart)", mix: { equity: 1 }, proxy: { URTH: 1 }, note: "Stand-in: URTH (MSCI World)" },
    { key: "flagship", name: "Endowus Flagship Portfolio: Measured (40% equities / 60% fixed income)", platform: "Endowus (Flagship)", mix: { equity: 0.4, bond: 0.6 }, proxy: { URTH: 0.4, BNDW: 0.6 }, note: "Stand-in: 40% URTH (MSCI World) + 60% BNDW (global bonds)" },
  ];

  const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
  const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[,$\s]/g, "")) : NaN);
  const uid = () => Math.random().toString(36).slice(2, 10);

  function normalizeWeights(obj, keep) {
    const entries = Object.entries(obj || {}).filter(([k, v]) => keep(k) && Number.isFinite(v) && v > 0);
    const sum = entries.reduce((a, [, v]) => a + v, 0);
    return sum > 0 ? Object.fromEntries(entries.map(([k, v]) => [k, v / sum])) : null;
  }

  /* Validate and clean one item (from the form or from storage). known: Set of tickers usable as stand-ins.
     Returns { item } or { error }. Never trusts its input. */
  function normalize(raw, known = new Set()) {
    if (!raw || typeof raw !== "object") return { error: "Not a valid entry." };
    const name = clean(raw.name, 90);
    if (!name) return { error: "Give it a name." };
    const currency = CURRENCIES.includes(raw.currency) ? raw.currency : null;
    if (!currency) return { error: "Choose SGD or USD." };
    const value = num(raw.value);
    if (!(value > 0) || value > 1e12) return { error: "Enter its current value (above zero)." };
    let invested = raw.invested === null || raw.invested === undefined || raw.invested === "" ? null : num(raw.invested);
    if (invested !== null && !(invested >= 0 && invested <= 1e12)) return { error: "The amount invested must be zero or more." };
    const mix = normalizeWeights(raw.mix, (k) => CLASSES.includes(k)) || { equity: 1 };
    const proxy = raw.proxy ? normalizeWeights(raw.proxy, (k) => known.has(k)) : null;
    if (raw.proxy && Object.keys(raw.proxy).length && !proxy) return { error: "None of the stand-in tickers is known to this app." };
    const updated = isDate(raw.updated) ? raw.updated : null;
    const history = (Array.isArray(raw.history) ? raw.history : []).filter((h) => h && isDate(h.date) && num(h.value) > 0)
      .map((h) => ({ date: h.date, value: num(h.value), invested: h.invested == null || h.invested === "" ? null : num(h.invested) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-MAX_HISTORY);
    return { item: { id: clean(raw.id, 16) || uid(), name, platform: clean(raw.platform, 50), currency, value, invested, mix, proxy, updated: updated || (history.length ? history[history.length - 1].date : null), history } };
  }

  /* Record a new value on a date. Same date replaces that point; the item's value/updated follow the latest point. */
  function addPoint(item, { date, value, invested }) {
    const v = num(value);
    if (!isDate(date) || !(v > 0)) return item;
    const inv = invested === undefined ? item.invested : invested === null || invested === "" ? null : num(invested);
    const history = item.history.filter((h) => h.date !== date).concat([{ date, value: v, invested: inv }]).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-MAX_HISTORY);
    const last = history[history.length - 1];
    return { ...item, history, value: last.value, invested: last.invested, updated: last.date };
  }

  const ageDays = (iso, nowMs = Date.now()) => {
    if (!isDate(iso)) return null;
    const n = new Date(nowMs);
    return Math.round((Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - Date.parse(iso + "T00:00:00Z")) / 864e5);
  };
  const staleness = (iso, nowMs) => { const a = ageDays(iso, nowMs); return a == null ? "unknown" : a > VERY_STALE_DAYS ? "very" : a > STALE_DAYS ? "stale" : "fresh"; };

  /* A synthetic price path (starting at 100) for a weighted mix of stand-in series, rebalanced daily. getSeries(t) must
     return a Float64Array aligned with the app's dates, or undefined. Returns null if any stand-in is missing. */
  function blendSeries(proxy, getSeries, n) {
    if (!proxy) return null;
    const ts = Object.keys(proxy), ser = ts.map(getSeries);
    if (!ts.length || ser.some((s) => !s || s.length !== n)) return null;
    const out = new Float64Array(n); out[0] = 100;
    for (let i = 1; i < n; i++) {
      let r = 0;
      ts.forEach((t, k) => { const a = ser[k][i], b = ser[k][i - 1]; if (a === a && b === b && b > 0) r += proxy[t] * (a / b - 1); });
      out[i] = out[i - 1] * (1 + r);
    }
    return out;
  }

  /* Today's rough value: the last value entered, moved by how the stand-in has moved since that date.
     -> { estimated, sinceUpdate, days, asOf } or null when there is no stand-in or no date. */
  function estimate(item, blend, dates) {
    if (!blend || !item.updated || !dates.length) return null;
    let idx = -1;
    for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= item.updated) { idx = i; break; }
    if (idx < 0) return null;                              // entered before our price history starts
    const last = dates.length - 1, ratio = blend[last] / blend[idx];
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    return { estimated: item.value * ratio, sinceUpdate: ratio - 1, days: last - idx, asOf: dates[last] };
  }

  const gain = (value, invested) => (invested > 0 ? { amount: value - invested, pct: value / invested - 1 } : null);

  /* Funds and ETFs held directly: which asset class? Anything that is not clearly a bond / cash / commodity fund is equity. */
  function classifyHolding(info) {
    if (!info || info.type !== "ETF") return "equity";
    const c = String(info.category || "");
    if (/money market|ultrashort|ultra-short/i.test(c)) return "cash";
    if (/bond|treasur|government|credit|fixed income|high yield|inflation-protected|muni/i.test(c)) return "bond";
    if (/commodit|gold|silver|precious|digital asset|crypto|bitcoin|ethereum|currency/i.test(c)) return "other";
    return "equity";
  }

  /* entries: [{currency, value, mix:{equity,bond,cash,other}}] -> { SGD: {total, equity, bond, cash, other (amounts)}, ... } */
  function allocate(entries) {
    const out = {};
    for (const e of entries) {
      if (!(e.value > 0)) continue;
      const c = (out[e.currency] ||= { total: 0, equity: 0, bond: 0, cash: 0, other: 0 });
      const mix = normalizeWeights(e.mix, (k) => CLASSES.includes(k)) || { equity: 1 };
      c.total += e.value;
      for (const [k, w] of Object.entries(mix)) c[k] += e.value * w;
    }
    return out;
  }

  const api = { PRESETS, CURRENCIES, STALE_DAYS, VERY_STALE_DAYS, MAX_ITEMS, normalize, addPoint, ageDays, staleness, blendSeries, estimate, gain, classifyHolding, allocate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Other = api;
})(typeof self !== "undefined" ? self : this);
