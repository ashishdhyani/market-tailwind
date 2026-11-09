"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../site/lookup.js");
const V = require("../site/lookup_view.js");

let ok = 0;
const t = (cond, msg) => { assert.ok(cond, msg); ok++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); ok++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); ok++; };
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `lookup_${n}_.json`), "utf8"));
const NOW = Date.parse("2026-11-09T14:00:00Z");

// ---- 1. symbols
eq(["sofi", " $SOFI ", "brk.b", "D05.SI", "BF.B", "BP.L", "a-b"].map(L.cleanSymbol), ["SOFI", "SOFI", "BRK-B", "D05.SI", "BF-B", "BP.L", "A-B"], "symbol cleaning");
for (const bad of ["", " ", "../etc", "A B", "SOFI;rm", "<script>", "^GSPC", "A".repeat(13), "-AB", ".SI", null, undefined, "SO\nFI", "a/b"]) t(L.cleanSymbol(bad) === null, `rejects ${JSON.stringify(bad)}`);

// ---- 2. real files go through sanitize intact
const reps = {};
for (const n of ["SOFI", "TSM", "QQQM"]) {
  const r = L.sanitize(fx(n));
  t(r.report && r.report.found, `${n} found`);
  reps[n] = r.report;
  const raw = fx(n);
  eq(r.report.prices.dates, raw.prices.dates, `${n} dates kept`);
  eq(r.report.prices.close, raw.prices.close, `${n} closes kept`);
  eq(r.report.financials.annual.length, raw.financials.annual.length, `${n} annual statements kept`);
  eq(r.report.news.length, raw.news.length, `${n} news kept`);
  eq(r.report.info.name, raw.info.name, `${n} info kept`);
}
const missing = L.sanitize(fx("BADSYM123"));
t(missing.report && missing.report.found === false && /no price data/i.test(missing.report.error), "not-found report keeps its message");

// ---- 3. hostile / broken files
t(L.sanitize(null).error && L.sanitize("x").error && L.sanitize({ version: 2 }).error && L.sanitize({ version: 1, symbol: "../x" }).error, "garbage refused");
const evil = fx("SOFI");
evil.profile.name = '<img src=x onerror=alert(1)>'; evil.profile.summary = "<script>alert(1)</script>"; evil.profile.website = "javascript:alert(1)";
evil.news[0].url = "javascript:alert(1)"; evil.news[0].title = '"><svg onload=alert(1)>'; evil.news[1].time = "not a date";
evil.info["__proto__"] = { polluted: 1 }; evil.info.constructor = "x"; evil.info.name = "N".repeat(5000);
evil.prices.close[5] = "7"; evil.prices.close[6] = -3; evil.prices.close[7] = null; evil.prices.dates[8] = "2020-13-45"; evil.insiders[0].value = "1e999"; evil.analysts.targets.mean = Infinity;
evil.dividends = "nope"; evil.financials = null; evil.holders = []; evil.errors = { ["x".repeat(500)]: "y".repeat(500) };
const clean = L.sanitize(JSON.parse(JSON.stringify(evil).replace(/Infinity/g, "1e999"))).report;
t(clean && clean.found, "survives hostile input");
t({}.polluted === undefined && clean.info.polluted === undefined, "no prototype pollution");
t(clean.info.name.length <= 120, "long strings capped");
t(clean.news[0].url === null && clean.profile.website === null, "javascript: links dropped");
t(clean.news[1].time === null, "bad date dropped");
t(clean.prices.close.every((v) => typeof v === "number" && v > 0) && clean.prices.dates.every((d, i, a) => i === 0 || d > a[i - 1]), "price series clean and ascending");
t(clean.dividends.length === 0 && clean.financials.annual.length === 0, "wrong types become empty lists");
t(Object.keys(clean.errors).every((k) => k.length <= 40), "error keys capped");
const html = V.reportHtml(clean, L.analyze(clean, { now: NOW }), NOW);
t(!/<script|<img|<svg|href="javascript/i.test(html), "hostile markup is escaped in the page");
t(/&lt;img/.test(html), "shown as text instead");

// ---- 4. prices: hand cross-check
const p = reps.SOFI.prices, n = p.close.length;
const S = L.priceStats(p);
near(S.ret[21], p.close[n - 1] / p.close[n - 22] - 1, 1e-12, "1-month return");
near(S.ret[252], p.close[n - 1] / p.close[n - 253] - 1, 1e-12, "1-year return");
near(S.sma50, p.close.slice(-50).reduce((a, b) => a + b, 0) / 50, 1e-9, "50-day average");
near(S.sma200, p.close.slice(-200).reduce((a, b) => a + b, 0) / 200, 1e-9, "200-day average");
near(S.hi52, Math.max(...p.close.slice(-252)), 0, "52-week high"); near(S.lo52, Math.min(...p.close.slice(-252)), 0, "52-week low");
near(S.drawdown_1y, p.close[n - 1] / S.hi52 - 1, 1e-12, "drawdown");
const rets = p.close.slice(-64).map((v, i, a) => (i ? v / a[i - 1] - 1 : null)).slice(1), mu = rets.reduce((a, b) => a + b, 0) / 63;
near(S.vol_63d, Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / 62) * Math.sqrt(252), 1e-9, "63-day volatility");
t(S.trend === (S.price > S.sma200 ? 1 : 0) + (S.sma50 > S.sma200 ? 1 : 0), "trend score");
const short = L.priceStats({ dates: ["2026-01-01", "2026-01-02", "2026-01-05"], close: [10, 11, 12] });
t(short.ret[21] === null && short.trend === null && short.fullYear === false && short.sma50 === null, "short history gives n/a, not NaN");

// ---- 5. relative to SPY: stock = 2x SPY's daily moves -> beta 2, correlation 1
const dates = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10));
let sv = 100, mv = 100; const spyC = [], stkC = [];
for (let i = 0; i < 300; i++) { const r = Math.sin(i / 3) * 0.01 + (i % 7 ? 0.001 : -0.004); mv *= 1 + r; sv *= 1 + 2 * r; spyC.push(mv); stkC.push(sv); }
const rel = L.relative({ dates, close: stkC }, { dates, close: spyC });
near(rel.beta, 2, 1e-9, "beta"); near(rel.corr, 1, 1e-9, "correlation");
near(rel.diff[21], (stkC[299] / stkC[278] - 1) - (spyC[299] / spyC[278] - 1), 1e-12, "difference vs SPY");
t(L.relative({ dates, close: stkC }, null) === null && L.relative({ dates, close: stkC }, { dates: ["1999-01-01"], close: [1] }) === null, "no SPY overlap -> null");
const gappy = L.relative({ dates, close: stkC }, { dates: dates.filter((_, i) => i % 2 === 0), close: spyC.filter((_, i) => i % 2 === 0) });
t(gappy && Number.isFinite(gappy.beta), "SPY with missing days is forward-filled");

// ---- 6. percentiles
const rows = Array.from({ length: 100 }, (_, i) => ({ ret_126: i / 100, ret_63: i / 100, ret_21: i / 100, mom_12_1: i / 100, vol_63d: (i + 1) / 100, drawdown_1y: -(100 - i) / 100 }));
const pc = L.percentiles({ ret: { 126: 0.505, 63: 0.255, 21: -1 }, mom_12_1: null, vol_63d: 0.305, drawdown_1y: -0.5 }, rows);
near(pc.ret_126, 0.51, 1e-12, "beats 51%"); near(pc.ret_63, 0.26, 1e-12, "beats 26%"); near(pc.ret_21, 0, 0, "beats none");
t(pc.mom_12_1 === null, "missing value -> null"); near(pc.calm, 0.70, 1e-12, "calmer than 70%"); near(pc.near_high, 0.50, 1e-12, "closer to high than 50%");
t(L.percentiles({ ret: {} }, rows.slice(0, 5)) === null && L.percentiles({ ret: {} }, null) === null, "too small a universe -> null");

// ---- 7. statements
const st = (period, revenue, o = {}) => ({ period, revenue, gross_profit: null, operating_income: null, net_income: null, ebitda: null, eps: null, operating_cf: null, capex: null, fcf: null, cash: null, debt: null, equity: null, assets: null, ...o });
const T = L.trends({ annual: [st("2025-12-31", 150, { gross_profit: 75, net_income: 15, fcf: 10, cash: 50, debt: 20 }), st("2024-12-31", 120, { fcf: 8 }), st("2023-12-31", 100, { fcf: 5 }), st("2022-12-31", 80, { fcf: 1 })], quarterly: [st("2026-09-30", 60), st("2026-06-30", 50), st("2026-03-31", 40), st("2025-12-31", 40), st("2025-09-30", 40)] });
near(T.annual[0].rev_growth, 0.25, 1e-12, "annual growth"); near(T.annual[0].gross_margin, 0.5, 1e-12, "gross margin"); near(T.annual[0].net_margin, 0.1, 1e-12, "net margin"); eq(T.annual[0].net_cash, 30, "net cash");
t(T.annual[3].rev_growth === null, "oldest year has no growth"); near(T.quarterly[0].rev_growth, 0.5, 1e-12, "quarter vs year-ago quarter");
t(T.revGrowingAll === true && T.revUpYears === 3 && T.fcfPositiveYears === 4 && T.fcfYears === 4, "trend summary");
t(L.trends({ annual: [], quarterly: [] }).latestGrowth === null, "no statements -> nulls");
const T2 = L.trends({ annual: [st("2025-12-31", 90), st("2024-12-31", 100), st("2023-12-31", 80)], quarterly: [] });
t(T2.revGrowingAll === false && T2.latestGrowth < 0, "falling sales detected");

// ---- 8. analysts, earnings, insiders, dividends, news
const base = JSON.parse(JSON.stringify(reps.SOFI));
const an = L.analystView({ ...base, info: { analysts: 10, target: 25 }, analysts: { trend: [{ strongBuy: 2, buy: 3, hold: 3, sell: 1, strongSell: 1 }], targets: { mean: 24 } } }, 20);
near(an.upside, 0.2, 1e-12, "target upside uses the mean target"); near(an.buyShare, 0.5, 1e-12, "buy share"); eq(an.total, 10, "analyst total");
const ev = L.earningsView({ earnings: { history: [{ date: "d4", estimate: 1, actual: 1.1 }, { date: "d3", estimate: 1, actual: 1 }, { date: "d2", estimate: 1, actual: 2 }, { date: "d1", estimate: null, actual: 3 }, { date: "d0", estimate: 1, actual: 0.5 }] } });
t(ev.last4 === 4 && ev.beats === 2 || ev.last4 === 3, `earnings beats counted (${ev.last4}/${ev.beats})`);
const ins = L.insiderView({ insiders: [{ text: "Purchase at price 10 per share.", value: 100 }, { text: "Sale at price 11 per share.", value: 300 }, { text: "Stock Gift at price 0 per share.", value: 0 }, { text: "Stock Award(Grant) at price 0", value: 0 }, { text: "Sold under 10b5-1", value: 50 }, { text: null, value: 5 }] });
eq(ins, { buys: 1, sells: 2, buyValue: 100, sellValue: 350 }, "insider classification");
const dv = L.dividendView({ dividends: [["2024-03-01", 0.5], ["2025-03-01", 0.5], ["2025-09-01", 0.5], ["2026-03-01", 0.6], ["2026-09-01", 0.6]] }, 40, "2026-11-01");
near(dv.ttm, 1.2, 1e-12, "12-month dividends"); eq(dv.perYear, 2, "payments per year"); near(dv.yield, 0.03, 1e-12, "yield"); near(dv.change, 0.2, 1e-12, "dividend change"); eq(dv.last.length, 5, "payments listed");
t(L.dividendView({ dividends: [] }, 40, "2026-11-01") === null, "no dividends -> null");
const nv = L.newsView({ news: [{ score: 0.5 }, { score: 0.3 }, { score: -0.4 }, { score: 0 }] });
t(nv.n === 4 && nv.pos === 2 && nv.neg === 1 && nv.word === "neutral", `news tone (${nv.word})`); t(L.newsView({ news: [] }).n === 0, "no news");

// ---- 9. evidence lists
const A = {};
for (const k of Object.keys(reps)) A[k] = L.analyze(reps[k], { now: NOW });
t(A.TSM.checks.notes.some((x) => /reports in TWD but its shares trade in USD/.test(x)), "ADR currency mismatch warned");
t(A.TSM.currencyMismatch && !A.TSM.ev.metrics.some((m) => /Price \/ (sales|book)|EV ?\/ ?EBITDA|Free-cash-flow yield/i.test(m.label)), "ADR: currency-mixing ratios hidden");
t(!A.SOFI.currencyMismatch && A.SOFI.ev.metrics.some((m) => /Price \/ book/i.test(m.label)) && A.SOFI.ev.metrics.some((m) => /Free-cash-flow yield/i.test(m.label)), "same-currency stock keeps them");
const unfiltered = L.analyze({ ...reps.TSM, profile: { ...reps.TSM.profile, financial_currency: "USD" } }, { now: NOW });
t(unfiltered.ev.metrics.some((m) => /Price \/ book|Free-cash-flow yield/i.test(m.label)), "without a mismatch TSM's data would show them (the filter is what removes them)");
t(A.TSM.ev.metrics.some((m) => /Forward P\/E/.test(m.label)) && A.TSM.ev.metrics.some((m) => /Return on equity/.test(m.label)), "currency-free ratios kept");
t(A.QQQM.checks.good.some((x) => /Low cost/.test(x)) && A.QQQM.checks.notes.some((x) => /fund/.test(x)), "ETF: cost and fund note");
t(A.SOFI.checks.notes.some((x) => /banks and lenders/.test(x)), "lender caveat on free cash flow");
for (const k of Object.keys(A)) { const c = A[k].checks; t([...c.good, ...c.bad, ...c.notes].every((x) => typeof x === "string" && x.length > 10 && !/NaN|undefined|null|Infinity/.test(x)), `${k} check lines are clean`); }
const mk = (over) => { const r = JSON.parse(JSON.stringify(reps.SOFI)); return Object.assign(r, over); };
const flat = (c) => [...c.good, ...c.bad].join(" | ");
const losing = L.analyze(mk({ info: { type: "EQUITY", roe: -0.3, net_margin: -0.4, sector: "Technology", currency: "USD" } }), { now: NOW });
t(/Reports a loss/.test(flat(losing.checks)), "loss-making flagged");
const thin = L.analyze(mk({ extra: { avg_volume: 100 } }), { now: NOW });
t(/Thinly traded/.test(flat(thin.checks)), "thin trading flagged");
const earnSoon = L.analyze(mk({ info: { ...reps.SOFI.info, next_earnings: "2026-11-12" } }), { now: NOW });
t(/Earnings in 3 days|Earnings around/.test(flat(earnSoon.checks)) || earnSoon.checks.bad.some((x) => /Earnings/i.test(x)), "earnings soon flagged");
const stale = L.analyze(mk({}), { now: Date.parse("2026-12-30T00:00:00Z") });
t(stale.checks.notes.some((x) => /latest price is from/.test(x)), "stale price noted");
const sho = L.analyze(mk({ extra: { short_pct_float: 0.25 } }), { now: NOW });
t(/sold short/.test(flat(sho.checks)), "short interest flagged");
t(!/\b(buy|sell|hold)\s+(it|this|now)\b|you should|we recommend/i.test(Object.values(A).map((a) => flat(a.checks)).join(" ")), "no instructions in the evidence lists");

// ---- 10. the rendered page
for (const k of Object.keys(reps)) {
  const h = V.reportHtml(reps[k], A[k], NOW);
  t(h.length > 2000, `${k} report renders`);
  t(!/NaN|undefined|Infinity|>null<|\[object/.test(h), `${k} report has no NaN/undefined`);
  t(/not financial advice/i.test(h), `${k} report carries the disclaimer`);
  t((h.match(/<details/g) || []).length === (h.match(/<\/details>/g) || []).length && (h.match(/<table/g) || []).length === (h.match(/<\/table>/g) || []).length, `${k} balanced tags`);
  t(!/href="(?!https?:\/\/|#)/.test(h), `${k} only http(s) links`);
}
t(/Fund numbers/.test(V.reportHtml(reps.QQQM, A.QQQM, NOW)) && !/Financial statements/.test(V.reportHtml(reps.QQQM, A.QQQM, NOW)), "ETF page: fund layout");
t(/Financial statements/.test(V.reportHtml(reps.SOFI, A.SOFI, NOW)) && /TWD/.test(V.reportHtml(reps.TSM, A.TSM, NOW)), "stock page: statements, in the reporting currency");
const inApp = V.reportHtml(reps.SOFI, L.analyze(reps.SOFI, { now: NOW, inApp: { rank: 7, of: 500 } }), NOW);
t(/ranked #7 of 500/.test(inApp) && /Not in this app/.test(V.reportHtml(reps.SOFI, A.SOFI, NOW)), "in-app badge");
t(V.big(3.81e12, "TWD") === "TWD 3.8T" && V.big(-2.5e9, "USD") === "-$2.5B" && V.big(null, "USD") === "–" && V.big(1234, "") === "1234.00", "money formatting");

// ---- 11. freshness
t(L.isFresh({ fetched_ts: NOW / 1000 - 3600 }, NOW) && !L.isFresh({ fetched_ts: NOW / 1000 - 7 * 3600 }, NOW) && !L.isFresh({ fetched_ts: 0 }, NOW), "freshness window");

console.log(`lookup: all ${ok} checks passed`);
