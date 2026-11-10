"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const O = require("../site/lookup_options.js");
const L = require("../site/lookup.js");
const V = require("../site/lookup_view.js");

let ok = 0;
const t = (c, m) => { assert.ok(c, m); ok++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); ok++; };

// ---- 1. Black-Scholes against textbook values (S=100, K=100, T=1, sigma=20%, r=5%: call 10.4506, put 5.5735)
near(O.bsPrice("call", 100, 100, 1, 0.2, 0.05), 10.4506, 2e-4, "call price");
near(O.bsPrice("put", 100, 100, 1, 0.2, 0.05), 5.5735, 2e-4, "put price");
for (const [S, K, T, s] of [[100, 90, 0.25, 0.3], [50, 60, 0.1, 0.8], [200, 200, 2, 0.15]]) {
  near(O.bsPrice("call", S, K, T, s, 0.04) - O.bsPrice("put", S, K, T, s, 0.04), S - K * Math.exp(-0.04 * T), 1e-6, "put-call parity");
}

// ---- 2. implied volatility round trip, and refusal of impossible prices
for (const sigma of [0.1, 0.25, 0.5, 1, 2.5]) for (const [K, T, type] of [[100, 0.1, "call"], [90, 0.5, "put"], [115, 0.02, "call"], [100, 1, "put"]]) {
  const p = O.bsPrice(type, 100, K, T, sigma);
  if (p < 1e-4) continue;                                       // too cheap to carry information
  const iv = O.impliedVol(type, p, 100, K, T);
  t(iv === null || Math.abs(iv - sigma) < 2e-3, `round trip ${type} K=${K} T=${T} sigma=${sigma}: ${iv}`);
}
t(O.impliedVol("call", 0.5, 100, 90, 0.1) === null, "price below intrinsic -> null");
t(O.impliedVol("call", 150, 100, 100, 0.1) === null, "price above the stock -> null");
t(O.impliedVol("put", 0, 100, 100, 0.1) === null && O.impliedVol("call", 5, 100, 100, 0) === null && O.impliedVol("call", NaN, 100, 100, 0.1) === null, "bad inputs -> null");

// ---- 3. reading the file: hostile rows
t(O.sanitize(null) === null && O.sanitize({}) === null && O.sanitize({ expiries: "x" }) === null && O.sanitize({ expiries: [] }) === null, "garbage -> null");
const dirty = O.sanitize({ spot: "x", expiries: [
  { date: "2026-11-20", calls: [[100, 1, 0.9, 1.1, 5, 7, 0.5, "2026-11-09"], [-5, 1, 1, 1, 1, 1, 1, null], ["a", 1], null, [100, "x", NaN, Infinity, -4, "9", 0, "bad"], [105, 2, 0, 0, null, null, null, "2026-11-09"]], puts: "nope" },
  { date: "2026-13-45", calls: [[1, 1, 1, 1, 1, 1, 1, null]], puts: [] }, { date: "2026-12-18", calls: [], puts: [] }, null,
] });
t(dirty && dirty.spot === null && dirty.expiries.length === 1, "bad expiries dropped");
const dc = dirty.expiries[0].calls;
t(dc.length === 3 && dc.every((c) => c.k > 0) && dc[0].k === 100 && dc[1].k === 100 && dc[2].k === 105, "bad contracts dropped, rest sorted by strike");
t(dc.some((c) => c.last === null && c.bid === null && c.ask === null && c.vol === 0 && c.t === null), "junk numbers become null/0");
t(dirty.expiries[0].puts.length === 0, "non-array side -> empty");
t(O.sanitize({ expiries: Array.from({ length: 40 }, (_, i) => ({ date: `2026-12-${String(i % 28 + 1).padStart(2, "0")}`, calls: [[1, 1, 1, 1, 1, 1, 1, null]], puts: [] })) }).expiries.length <= 14, "expiry cap");
t(O.sanitize({ expiries: [{ date: "2026-12-18", calls: Array.from({ length: 5000 }, (_, i) => [i + 1, 1, 1, 1, 1, 1, 1, null]), puts: [] }] }).expiries[0].calls.length <= 600, "contract cap");

// ---- 4. a synthetic market priced at known volatility: the analysis must recover it
const SESSION = "2026-11-09", SPOT = 100;
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const ivFn0 = () => 0.5;
function chain(days, ivFn = ivFn0, o = {}) {
  const T = days / 365, calls = [], puts = [];
  for (let K = 70; K <= 130; K += 2.5) {
    const sg = ivFn(K, days), cp = O.bsPrice("call", SPOT, K, T, sg), pp = O.bsPrice("put", SPOT, K, T, sg);
    calls.push([K, +cp.toFixed(2), 0, 0, o.vol ?? 50, o.oi ?? 100, 1e-5, SESSION]);
    puts.push([K, +pp.toFixed(2), 0, 0, o.vol ?? 50, o.oi ?? 100, 1e-5, SESSION]);
  }
  return { date: addDays(SESSION, days), calls, puts };
}
const A1 = O.analyze(O.sanitize({ spot: SPOT, expiries: [chain(3), chain(10), chain(30), chain(90)] }), { spot: SPOT, session: SESSION, realizedVol: 0.4 });
t(A1 && A1.session === SESSION && A1.spot === SPOT, "session and spot");
near(A1.headline.iv, 0.5, 0.01, "headline volatility recovered");
t(A1.headline.days === 10, "headline expiry is the first one at least a week out");
near(A1.headline.move, SPOT * 0.5 * Math.sqrt(10 / 365), 0.1, "expected move = price x vol x sqrt(time)");
near(A1.headline.low, SPOT - A1.headline.move, 1e-9, "range low"); near(A1.headline.high, SPOT + A1.headline.move, 1e-9, "range high");
for (const r of A1.expiries) near(r.iv, 0.5, 0.015, `volatility at ${r.days} days`);
t(A1.expiries.every((r, i, a) => i === 0 || r.move > a[i - 1].move), "expected move grows with time");
near(A1.iv.ratio, 0.5 / 0.4, 0.03, "implied vs realised ratio"); t(A1.iv.word === "in line" || A1.iv.word === "high", "ratio 1.25 is not flagged low");
t(O.analyze(O.sanitize({ expiries: [chain(10)] }), { spot: SPOT, session: SESSION, realizedVol: 0.3 }).iv.word === "high", "1.67x realised flagged high");
t(O.analyze(O.sanitize({ expiries: [chain(10)] }), { spot: SPOT, session: SESSION, realizedVol: 0.9 }).iv.word === "low", "0.55x realised flagged low");
t(A1.iv.term === "flat", "flat term structure");
t(A1.quotesLive === false && A1.notes.some((n) => /market was closed/.test(n)), "closed-market note");

// spot between strikes interpolates; 101.3 should still give 50%
const A2 = O.analyze(O.sanitize({ expiries: [chain(10)] }), { spot: 101.3, session: SESSION, realizedVol: null });
near(A2.headline.iv, 0.5, 0.03, "volatility with the price between strikes");
t(A2.iv.ratio === null && A2.iv.word === null, "no realised vol -> no comparison");

// term structure: expensive near, cheap far = inverted; the reverse = normal
const inv = O.analyze(O.sanitize({ expiries: [chain(10, (K, d) => 0.7), chain(90, () => 0.4)] }), { spot: SPOT, session: SESSION });
t(inv.iv.term === "inverted", "inverted term structure");
const nor = O.analyze(O.sanitize({ expiries: [chain(10, () => 0.3), chain(90, () => 0.45)] }), { spot: SPOT, session: SESSION });
t(nor.iv.term === "normal", "normal term structure");

// ---- 5. live quotes beat stale last trades; wide quotes are ignored
const c = { k: 100, last: 5, bid: 4.8, ask: 5.2, vol: 1, oi: 1, t: "2026-11-01" };
near(O.mark(c, SESSION), 5.0, 1e-9, "live mid used even though the last trade is old");
t(O.mark({ ...c, bid: 1, ask: 9 }, SESSION) === null, "wide quote and stale last trade -> no price");
near(O.mark({ ...c, bid: 1, ask: 9, t: SESSION }, SESSION), 5, 1e-9, "wide quote falls back to a same-session last trade");
t(O.mark({ ...c, bid: 0, ask: 0 }, SESSION) === null, "no quote, old trade -> null");
const stale = chain(10); stale.calls.forEach((r) => { r[7] = "2026-10-01"; }); stale.puts.forEach((r) => { r[7] = "2026-10-01"; });
const AS = O.analyze(O.sanitize({ expiries: [stale, chain(30)] }), { spot: SPOT, session: SESSION });
t(AS.expiries[0].iv === null && AS.expiries[1].iv !== null, "an expiry with only stale trades gets no volatility, not a wrong one");
t(AS.headline.days === 30, "headline skips expiries without a volatility");

// ---- 6. earnings jump: a clean expiry at 40%, then one after earnings with an extra 8% jump
const base = 0.4, jump = 0.08, T2 = 25 / 365;
const jumpIv = Math.sqrt(base * base + jump * jump / T2);
const earn = O.analyze(O.sanitize({ expiries: [chain(10, () => base), chain(25, () => jumpIv)] }), { spot: SPOT, session: SESSION, earnings: addDays(SESSION, 15) });
t(earn.earnings && earn.earnings.expiry === addDays(SESSION, 25), "earnings expiry found");
near(earn.earnings.jumpPct, jump, 0.01, "earnings jump recovered");
t(earn.expiries[1].earnings === true && earn.expiries[0].earnings === false, "expiry after earnings flagged");
const farEarn = O.analyze(O.sanitize({ expiries: [chain(10), chain(90)] }), { spot: SPOT, session: SESSION, earnings: addDays(SESSION, 20) });
t(farEarn.earnings === null, "no expiry near the earnings date -> no estimate (not noise)");
t(O.analyze(O.sanitize({ expiries: [chain(10), chain(25)] }), { spot: SPOT, session: SESSION, earnings: addDays(SESSION, -5) }).earnings === null, "past earnings ignored");

// ---- 7. put/call, premium, unusual activity, walls: hand-built
const hand = (calls, puts, d = 10) => ({ date: addDays(SESSION, d), calls, puts });
const row = (k, last, vol, oi, t = SESSION) => [k, last, 0, 0, vol, oi, 1e-5, t];
const H = O.analyze(O.sanitize({ expiries: [hand(
  [row(100, 3, 1000, 500), row(105, 1, 300, 2000), row(110, 0.5, 50, 10), row(95, 6, 400, 0), row(120, 0.1, 9000, 0), row(102, 2, 5000, 100, "2026-10-01")],
  [row(100, 3, 600, 400), row(95, 1, 100, 900), row(90, 0.5, 1500, 800)])] }), { spot: SPOT, session: SESSION });
t(H.pc.callVol === 1000 + 300 + 50 + 400 + 9000 && H.pc.putVol === 2200, "volume counts only the latest session (the 5000 stale one is excluded)");
near(H.pc.volRatio, 2200 / 10750, 1e-12, "put/call volume ratio"); t(H.pc.word === "calls dominate", "word for 0.2");
near(H.pc.callPremium, (1000 * 3 + 300 * 1 + 50 * 0.5 + 400 * 6 + 9000 * 0.1) * 100, 1e-6, "call premium"); near(H.pc.putPremium, (600 * 3 + 100 * 1 + 1500 * 0.5) * 100, 1e-6, "put premium");
t(H.pc.callOI === 500 + 2000 + 10 + 0 + 0 + 100 && H.pc.putOI === 2100 && !H.pc.thin, "open interest totals and not thin");
const u = H.unusual;
t(u.rows.length === 3 && u.total === 3, `unusual: only vol>=oi, vol>=200, premium>=50k, open interest known (got ${u.rows.map((r) => r.type + r.strike)})`);
t(u.rows[0].type === "call" && u.rows[0].strike === 100 && Math.abs(u.rows[0].premium - 300000) < 1e-6 && u.rows[0].ratio === 2, "largest first, with premium and volume/open-interest ratio");
t(u.rows.some((r) => r.type === "put" && r.strike === 90 && Math.abs(r.premium - 75000) < 1e-6) && !u.rows.some((r) => r.strike === 105 || r.strike === 110 || r.strike === 95), "small or already-open contracts excluded");
t(u.skippedNoOi === 1, "heavily traded contracts with no open interest are counted, not guessed");
near(u.rows.find((r) => r.type === "put" && r.strike === 90).otmPct, 0.10, 1e-12, "put 10% out of the money"); near(u.rows[0].otmPct, 0, 1e-12, "at the money");
t(u.calls === 1 && u.puts === 2, "calls/puts counted");
const lot = O.analyze(O.sanitize({ expiries: [hand([row(125, 1, 100000, 10)], [], 5)] }), { spot: SPOT, session: SESSION }).unusual.rows[0];
t(lot.lottery === true && Math.abs(lot.otmPct - 0.25) < 1e-12, "far out-of-the-money, short-dated bets labelled lottery-style");
const W = O.analyze(O.sanitize({ expiries: [hand([row(110, 1, 0, 700), row(105, 1, 0, 300), row(120, 1, 0, 50)], [row(90, 1, 0, 900), row(95, 1, 0, 100)]), hand([row(110, 1, 0, 300)], [], 100)] }), { spot: SPOT, session: SESSION });
t(W.walls.calls.top[0].strike === 110 && W.walls.calls.top[0].oi === 700 && W.walls.puts.top[0].strike === 90, "walls: biggest open interest first; expiries beyond 60 days left out");
near(W.walls.calls.top[0].distPct, 0.10, 1e-12, "wall distance from price"); near(W.walls.calls.top[0].share, 700 / 1050, 1e-12, "wall share");
const thin = O.analyze(O.sanitize({ expiries: [hand([row(100, 3, 20, 5)], [row(100, 3, 10, 5)])] }), { spot: SPOT, session: SESSION });
t(thin.pc.thin && thin.notes.some((n) => /Very few contracts/.test(n)), "thin trading flagged");
const etf = O.analyze(O.sanitize({ expiries: [hand([row(100, 3, 1000, 5)], [row(100, 3, 800, 5)])] }), { spot: SPOT, session: SESSION, isEtf: true });
t(etf.pc.word === "more calls than puts" && etf.pc.typical === "0.7 to 1.2", "ETF thresholds differ (0.8 is ordinary for a fund)");
t(O.analyze(O.sanitize({ expiries: [hand([row(100, 3, 1000, 5)], [row(100, 3, 800, 5)])] }), { spot: SPOT, session: SESSION }).pc.word === "more calls than puts", "0.8 for a stock still 'more calls'");
t(O.analyze(O.sanitize({ expiries: [hand([row(100, 3, 1000, 5)], [row(100, 3, 1100, 5)])] }), { spot: SPOT, session: SESSION }).pc.word === "leaning to puts", "1.1 for a stock leans to puts");
t(O.analyze(O.sanitize({ expiries: [hand([row(100, 3, 1000, 5)], [row(100, 3, 2000, 5)])] }), { spot: SPOT, session: SESSION }).pc.word === "puts dominate", "2.0 for a stock: puts dominate");
t(O.analyze(O.sanitize({ expiries: [hand([row(100, 3, 0, 5)], [row(100, 3, 0, 5)])] }), { spot: SPOT, session: SESSION }).pc.volRatio === null, "no calls traded -> no ratio, not Infinity");

// ---- 8. skew: puts 10% below priced at 60%, calls 10% above at 40%
const sk = O.analyze(O.sanitize({ expiries: [chain(10, (K) => (K <= 90 ? 0.6 : K >= 110 ? 0.4 : 0.5))] }), { spot: SPOT, session: SESSION });
t(sk.skew && sk.skew.word === "puts pricier", "skew detected"); near(sk.skew.value, 0.2, 0.02, "skew size");
t(O.analyze(O.sanitize({ expiries: [chain(10)] }), { spot: SPOT, session: SESSION }).skew.word === "balanced", "flat smile is balanced");
const calls = O.analyze(O.sanitize({ expiries: [chain(10, (K) => (K >= 110 ? 0.7 : 0.5))] }), { spot: SPOT, session: SESSION });
t(calls.skew.word === "calls pricier", "calls pricier detected");

// ---- 9. nothing to analyse
t(O.analyze(null, {}) === null && O.analyze({ expiries: [] }, {}) === null, "no options -> null");
const none = O.analyze(O.sanitize({ expiries: [hand([row(100, 0, 0, 5, null)], [])] }), { spot: SPOT, session: SESSION });
t(none && none.headline === null && none.iv === null && none.skew === null && none.notes.some((n) => /No usable option prices/.test(n)), "no usable prices: says so instead of inventing numbers");
t(O.analyze(O.sanitize({ expiries: [hand([row(100, 3, 1, 1)], [])] }), {}) === null, "no price at all -> null");

// ---- 10. the real files
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `lookup_${n}_.json`), "utf8"));
for (const n of ["SOFI", "TSM", "QQQM"]) {
  const rep = L.sanitize(fx(n)).report, A = L.analyze(rep, { now: Date.parse("2026-11-10T12:00:00Z") }), o = A.options;
  t(o && o.headline, `${n} has options analysis`);
  t(o.headline.iv > 0.1 && o.headline.iv < 1.5 && o.headline.movePct > 0.02 && o.headline.movePct < 0.3, `${n} headline vol ${o.headline.iv.toFixed(2)} and move ${o.headline.movePct.toFixed(3)} are plausible`);
  const mv = o.expiries.filter((r) => r.iv).map((r) => r.move);
  t(mv.length >= 3 && mv.every((v, i) => i === 0 || v >= mv[i - 1] * 0.9), `${n} expected move broadly grows with time`);
  t(!/NaN|Infinity|undefined/.test(JSON.stringify(o)), `${n} analysis has no NaN/Infinity`);
  t(o.pc.volRatio > 0 && o.pc.volRatio < 5, `${n} put/call ratio is sane (${o.pc.volRatio.toFixed(2)})`);
  const h = V.reportHtml(rep, A, Date.now());
  t(/Options: what traders are pricing in/.test(h) && (h.match(/class="lk-card"/g) || []).length === 4, `${n} shows four option cards`);
  t(!/NaN|undefined|Infinity|\[object/.test(h) && (h.match(/<details/g) || []).length === (h.match(/<\/details>/g) || []).length, `${n} page clean`);
  t(/not a forecast|not proof|does not say/i.test(h.replace(/<[^>]+>/g, " ")), `${n} states what options cannot say`);
}
const noOpt = L.sanitize({ ...fx("SOFI"), options: null }).report;
t(/Yahoo lists no options/.test(V.reportHtml(noOpt, L.analyze(noOpt, { now: Date.now() }), Date.now())), "report without options says so");
const evil = fx("SOFI"); evil.options.expiries[0].date = "<img src=x>"; evil.options.expiries[1].calls[0] = ["<script>", 1];
const evilRep = L.sanitize(evil).report;
t(!/<script|<img/i.test(V.reportHtml(evilRep, L.analyze(evilRep, { now: Date.now() }), Date.now())), "hostile options data cannot inject markup");

console.log(`lookup options: all ${ok} checks passed`);
