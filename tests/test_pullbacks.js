const P = require("../site/pullbacks.js");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const row = (o = {}) => ({ price: 100, ret_5: -0.02, ret_10: -0.05, ret_21: -0.15, ret_63: -0.05, ret_126: 0.12, trend: 2, ...o });
const good = { type: "EQUITY", roe: 0.2, net_margin: 0.12, target: 130, rec: 2.0, fwd_pe: 14, pe: 18, rev_growth: 0.08 };
const news = (z, n = 8) => ({ n, z, avg: 0.3 });
const keys = (l) => l.map((x) => x.key).sort().join(",");

// 1. A pullback with everything going for it: every supporting sign, no cautions
let a = P.assess({ t: "G", row: row(), info: good, news: news(0.4) });
ok(keys(a.supports) === "earnings,news,profit,rating,sales,target,trend,value" && a.cautions.length === 0, "all supports: " + keys(a.supports) + " | " + keys(a.cautions));
ok(Math.abs(a.upside - 0.30) < 1e-9 && a.net === 8, "upside / net");

// 2. A stock with everything against it: only cautions
a = P.assess({ t: "B", row: row({ ret_126: -0.3, trend: 0 }), info: { type: "EQUITY", roe: -0.3, net_margin: -0.9, target: 80, rec: 4, fwd_pe: 60, pe: 40, rev_growth: -0.1 }, news: news(-1) });
ok(keys(a.cautions) === "earnings,loss,news,rating,sales,target,trend,value" && a.supports.length === 0, "all cautions: " + keys(a.cautions) + " | " + keys(a.supports));
ok(/Reports a loss/.test(a.cautions.find((x) => x.key === "loss").text), "loss wording");

// 3. Missing data produces no opinion either way (not a false caution)
a = P.assess({ t: "N", row: row(), info: { type: "EQUITY" }, news: null });
ok(a.supports.length === 1 && a.supports[0].key === "trend" && a.cautions.length === 0, "sparse data: " + keys(a.supports));
a = P.assess({ t: "F", row: row(), info: good, news: news(0.9, 2) });                 // too few headlines for a tone
ok(!a.supports.some((x) => x.key === "news") && !a.cautions.some((x) => x.key === "news"), "2 headlines: no news opinion");
a = P.assess({ t: "A", row: row(), info: { type: "EQUITY", target: 108 }, news: null });  // +8%: not enough to count either way
ok(!a.supports.some((x) => x.key === "target") && !a.cautions.some((x) => x.key === "target"), "small upside is neutral");
a = P.assess({ t: "X", row: row(), info: { ...good, fwd_pe: -5 }, news: null });          // negative forward P/E is not "cheap"
ok(!a.supports.some((x) => x.key === "value" || x.key === "earnings"), "negative forward P/E");
a = P.assess({ t: "S", row: row(), info: good, news: { n: 5, z: null, avg: 0.5 } });       // no cross-sector z: absolute tone is used
ok(a.supports.some((x) => x.key === "news"), "absolute tone fallback");

// 4. screen(): who qualifies as "fell", ordering, limits, exclusions
const cands = [
  { t: "BEST", row: row({ ret_21: -0.20 }), info: good, news: news(0.5) },
  { t: "MID", row: row({ ret_21: -0.12 }), info: { type: "EQUITY", roe: 0.1, target: 112, rec: 3 }, news: news(0.1) },
  { t: "WORST", row: row({ ret_21: -0.30, ret_126: -0.4, trend: 0 }), info: { type: "EQUITY", roe: -0.2, net_margin: -0.5, target: 70 }, news: news(-1) },
  { t: "SMALLDROP", row: row({ ret_21: -0.04 }), info: good, news: news(0.5) },        // did not fall enough
  { t: "ETF1", row: row({ ret_21: -0.2 }), info: { type: "ETF" }, news: null },        // funds are not judged on company prospects
  { t: "NOINFO", row: row({ ret_21: -0.2 }), info: null, news: null },
  { t: "RISER", row: row({ ret_21: 0.2 }), info: good, news: news(0.5) },
];
let s = P.screen(cands, { window: "1m", minDrop: 0.10 });
ok(s.total === 3 && s.shown.map((x) => x.t).join() === "BEST,MID,WORST", "screen order " + s.shown.map((x) => x.t) + " total " + s.total);
ok(s.shown[0].drop === -0.20, "drop value");
ok(P.screen(cands, { window: "1m", minDrop: 0.10, limit: 2 }).shown.length === 2, "limit");
ok(P.screen(cands, { window: "1m", minDrop: 0.03 }).total === 4, "lower threshold finds more");
ok(P.screen(cands, { window: "1w", minDrop: 0.10 }).total === 0, "other window");
try { P.screen(cands, { window: "9y" }); ok(false, "unknown window should throw"); } catch (e) { ok(/unknown window/.test(e.message), "unknown window error"); }
ok(P.screen([], {}).total === 0 && Array.isArray(P.screen([], {}).shown), "empty input");

// 4b. a very sharp fall is flagged as a caution and costs a point (analyst data lags the price)
s = P.screen([{ t: "SHARP", row: row({ ret_21: -0.36 }), info: good, news: news(0.4) }, { t: "MILD", row: row({ ret_21: -0.12 }), info: good, news: news(0.4) }], { window: "1m", minDrop: 0.10 });
ok(s.shown[0].t === "MILD" && s.shown[1].t === "SHARP", "mild fall ranks above a collapse with the same evidence: " + s.shown.map((x) => x.t));
ok(s.shown[1].cautions.some((c) => c.key === "sharp") && !s.shown[0].cautions.some((c) => c.key === "sharp"), "sharp caution only on the collapse");
ok(P.screen([{ t: "W", row: row({ ret_5: -0.16 }), info: good, news: news(0.4) }], { window: "1w", minDrop: 0.10 }).shown[0].cautions.some((c) => c.key === "sharp"), "1w threshold is tighter");

// 5. the wording describes evidence; it never tells anyone what to do
const words = [...P.assess({ t: "G", row: row(), info: good, news: news(0.4) }).supports, ...P.assess({ t: "B", row: row({ ret_126: -0.3, trend: 0 }), info: { type: "EQUITY", roe: -0.3, target: 70, rec: 4 }, news: news(-1) }).cautions].map((x) => x.text).join(" ");
ok(!/\b(you should|buy now|sell now|must|guaranteed|will rise|will rebound)\b/i.test(words), "no instructions or promises: " + words.slice(0, 80));

// 6. real data: runs on every ticker, results are sane and the ordering is consistent
const E = require("../site/engine.js"), d = require("../site/data.json"), fund = require("../site/fundamentals.json").items;
const cs = d.watchlist.map((t) => {
  const p = Float64Array.from(d.prices[t], (v) => (v === null ? NaN : v)), f = E.featuresFor(p);
  let i = p.length - 1; while (i >= 0 && Number.isNaN(p[i])) i--;
  return { t, row: { price: p[i], ret_5: f.ret_5[i], ret_10: f.ret_10[i], ret_21: f.ret_21[i], ret_63: f.ret_63[i], ret_126: f.ret_126[i], trend: f.trend[i] }, info: fund[t] || null, news: null };
});
for (const w of Object.keys(P.WINDOWS)) {
  const r = P.screen(cs, { window: w, minDrop: 0.10 });
  ok(r.shown.every((x) => x.drop <= -0.10 && x.info.type !== "ETF"), "real " + w + ": only real fallers, no ETFs");
  ok(r.shown.every((x, k) => k === 0 || r.shown[k - 1].net >= x.net), "real " + w + ": sorted by net evidence");
  ok(r.shown.every((x) => x.supports.every((s) => s.text.length > 5) && Number.isFinite(x.net)), "real " + w + ": texts and scores sane");
  console.log(`  ${w}: ${r.total} stocks fell >= 10%; top: ${r.shown.slice(0, 3).map((x) => x.t + "(" + x.supports.length + "+/" + x.cautions.length + "-)").join(", ")}`);
}
console.log(bad ? `FAILED ${bad}` : "pullbacks.js ALL OK"); process.exit(bad ? 1 : 0);
