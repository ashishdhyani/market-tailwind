const S = require("../site/scoreboard.js"), Pk = require("../site/picks.js"), E = require("../site/engine.js");
const { spawnSync } = require("node:child_process"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const near = (a, b, m, tol = 1e-9) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b}`);

// ---------- scoreboard maths on hand-built prices ----------
const N = 100, dates = Array.from({ length: N }, (_, i) => "d" + String(i).padStart(3, "0"));
const grow = (rate, jumpAt = null, jump = 0) => { const p = new Float64Array(N); p[0] = 100; for (let i = 1; i < N; i++) p[i] = p[i - 1] * (1 + rate) * (i === jumpAt ? 1 + jump : 1); return p; };
const A = grow(0.01), B = grow(0.00), BENCH = grow(0.001);
const series = (t) => ({ A, B }[t]);
const labels = { "rank:long": "Rankings (long-term)" };
const ev = (snaps) => S.evaluate({ log: { snapshots: snaps }, series, dates, bench: BENCH, labels });

// one snapshot at d010: bought at d011's close, measured 5 / 21 / 63 days later
let r = ev([{ date: "d010", lists: { "rank:long": ["A", "B"] } }]);
let row = r.lists["rank:long"].rows[0];
near(row.byH[5].basket, (Math.pow(1.01, 5) - 1 + 0) / 2, "1 week basket (A grows, B flat, equal weight)");
near(row.byH[5].bench, Math.pow(1.001, 5) - 1, "1 week bench"); near(row.byH[5].excess, row.byH[5].basket - row.byH[5].bench, "excess");
near(row.byH[21].basket, (Math.pow(1.01, 21) - 1) / 2, "1 month basket"); near(row.byH[63].basket, (Math.pow(1.01, 63) - 1) / 2, "3 month basket");
near(row.sinceEntry.basket, (Math.pow(1.01, 88) - 1) / 2, "since entry runs to the last price"); ok(row.sinceEntry.days === 88, "days since entry");
ok(r.lists["rank:long"].label === "Rankings (long-term)" && r.snapshots === 1 && r.firstDate === "d010", "label / counts");

// the one-day delay: a jump between the snapshot date and the next close must NOT be credited to the pick
{
  const J = grow(0, 11, 0.20);                                                  // +20% arrives on d011, the day after the snapshot
  const r2 = S.evaluate({ log: { snapshots: [{ date: "d010", lists: { x: ["J"] } }] }, series: (t) => ({ J })[t], dates, bench: BENCH });
  near(r2.lists.x.rows[0].byH[5].basket, 0, "entry is d011's close, so the d011 jump is not counted");
  const r3 = S.evaluate({ log: { snapshots: [{ date: "d009", lists: { x: ["J"] } }] }, series: (t) => ({ J })[t], dates, bench: BENCH });
  near(r3.lists.x.rows[0].byH[5].basket, 0.20, "an earlier snapshot does capture it", 1e-9);
}

// not matured yet / pending / skipped
r = ev([{ date: "d090", lists: { k: ["A"] } }]);
ok(r.lists.k.rows[0].byH[5] !== null && r.lists.k.rows[0].byH[21] === null && r.lists.k.rows[0].byH[63] === null, "only matured horizons are filled in");
ok(r.lists.k.stats[21].n === 0 && r.lists.k.stats[5].n === 1, "stats count matured results only");
r = ev([{ date: "d099", lists: { k: ["A"] } }]);
ok(r.lists.k.rows[0].pending === true && Object.values(r.lists.k.rows[0].byH).every((v) => v == null) && r.lists.k.rows[0].sinceEntry === null, "latest snapshot is pending (the next close has not happened)");
ok(Object.keys(ev([{ date: "not-a-date", lists: { k: ["A"] } }]).lists).length === 0, "unknown date skipped");
ok(Object.keys(ev([{ date: "d010", lists: { k: [] } }]).lists).length === 0, "empty list skipped");
r = ev([{ date: "d010", lists: { k: ["A", "GONE"] } }]);
near(r.lists.k.rows[0].byH[5].basket, Math.pow(1.01, 5) - 1, "a pick with no prices is skipped, not counted as zero");
ok(ev([{ date: "d010", lists: { k: ["GONE"] } }]).lists.k.rows[0].byH[5] === null, "no usable picks -> no result");

// aggregation across snapshots: mean, hit rate, standard error, independent windows
r = ev([{ date: "d010", lists: { k: ["A"] } }, { date: "d020", lists: { k: ["B"] } }, { date: "d030", lists: { k: ["A"] } }]);
const st = r.lists.k.stats[5], ex = [Math.pow(1.01, 5) - Math.pow(1.001, 5), -(Math.pow(1.001, 5) - 1), Math.pow(1.01, 5) - Math.pow(1.001, 5)];
near(st.excess, ex.reduce((a, b) => a + b) / 3, "mean excess"); ok(st.n === 3 && Math.abs(st.hit - 2 / 3) < 1e-12, "hit rate 2 of 3");
const m = st.excess, sdv = Math.sqrt(ex.reduce((a, b) => a + (b - m) * (b - m), 0) / 2); near(st.se, sdv / Math.sqrt(3), "standard error");
ok(st.windows === 5, "independent 5-day windows spanned by d010..d030: " + st.windows);   // (30-10)/5 + 1
ok(r.lists.k.stats[63].n === 3 && r.lastDate === "d030", "63-day results exist for all three (d031 + 63 = d094 <= d099)");

// garbage in, nothing out (never a crash)
for (const bad_ of [null, undefined, {}, { snapshots: "x" }, { snapshots: [] }]) { const z = S.evaluate({ log: bad_, series, dates, bench: BENCH }); ok(z.snapshots === 0 && Object.keys(z.lists).length === 0, "empty log " + JSON.stringify(bad_)); }

// real prices: a past snapshot of two real stocks gives finite numbers that match a manual calculation
{
  const d = require("../site/data.json"), real = {}; for (const [t, v] of Object.entries(d.prices)) real[t] = Float64Array.from(v, (x) => (x === null ? NaN : x));
  const i = d.dates.indexOf("2025-06-02"), rr = S.evaluate({ log: { snapshots: [{ date: "2025-06-02", lists: { k: ["AAPL", "JPM"] } }] }, series: (t) => real[t], dates: d.dates, bench: real.SPY });
  const e = i + 1, x = (t, h) => real[t][e + h] / real[t][e] - 1;
  near(rr.lists.k.rows[0].byH[21].basket, (x("AAPL", 21) + x("JPM", 21)) / 2, "real data: 1 month basket");
  near(rr.lists.k.rows[0].byH[21].bench, x("SPY", 21), "real data: 1 month SPY");
  ok(Number.isFinite(rr.lists.k.rows[0].sinceEntry.basket), "real data: since entry");
}

// ---------- the default lists (picks.js) ----------
const d = require("../site/data.json"), fund = require("../site/fundamentals.json").items, news = require("../site/news.json");
const a = Pk.buildLists({ data: d, fund, news }), b = Pk.buildLists({ data: d, fund, news });
ok(JSON.stringify(a) === JSON.stringify(b), "deterministic");
ok(Pk.LISTS.every((l) => Array.isArray(a.lists[l.key])) && Object.keys(a.lists).length === 8, "8 lists: " + Object.keys(a.lists));
ok(a.date === d.dates[d.dates.length - 1] && a.universe === d.watchlist.length, "date / universe");
for (const h of Object.keys(E.HORIZONS)) ok(a.lists["rank:" + h].length === 5 && new Set(a.lists["rank:" + h]).size === 5 && a.lists["rank:" + h].every((t) => d.watchlist.includes(t)), "rank list " + h);
{
  const series = {}, feats = {}; for (const t of d.watchlist) { series[t] = Float64Array.from(d.prices[t], (x) => (x === null ? NaN : x)); feats[t] = E.featuresFor(series[t]); }
  const top = E.latestTable(d.watchlist, d.watchlist.map((t) => series[t]), d.watchlist.map((t) => feats[t]), d.dates.length, "long").rows.slice(0, 5).map((r) => r.ticker);
  ok(JSON.stringify(top) === JSON.stringify(a.lists["rank:long"]), "rank:long equals the Rankings tab's top 5");
  for (const t of a.lists["pullbacks:1m"]) ok(feats[t].ret_21[d.dates.length - 1] <= -0.10 && fund[t] && fund[t].type !== "ETF", "pullback pick " + t + " fell 10%+ and is a stock");
}
ok(a.lists["sectors:leaders"].length === 3 && new Set(a.lists["sectors:leaders"].map((t) => d.groups.find((g) => g.tickers.includes(t)).name)).size === 3, "3 leaders from 3 different sectors");
{ const n2 = Pk.buildLists({ data: d, fund: {}, news: null }); ok(Array.isArray(n2.lists["pullbacks:1m"]) && n2.lists["pullbacks:1m"].length === 0 && n2.lists["rank:long"].length === 5, "works without news or fundamentals"); }

// ---------- the log-writing tool ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mt-snap-")); const site = path.join(tmp, "site");
try {
  fs.cpSync(path.join(__dirname, "..", "site"), site, { recursive: true }); fs.rmSync(path.join(site, "picks_log.json"), { force: true });
  const run = () => spawnSync("node", [path.join(__dirname, "..", "tools", "snapshot_picks.mjs"), "site"], { cwd: tmp, encoding: "utf8" });
  let o = run(); ok(o.status === 0 && /Recorded/.test(o.stdout), "first run records: " + o.stdout + o.stderr);
  let log = JSON.parse(fs.readFileSync(path.join(site, "picks_log.json"), "utf8"));
  ok(log.snapshots.length === 1 && log.snapshots[0].date === a.date && log.snapshots[0].lists["rank:long"].join() === a.lists["rank:long"].join(), "log content matches buildLists");
  o = run(); ok(/Already recorded/.test(o.stdout) && JSON.parse(fs.readFileSync(path.join(site, "picks_log.json"), "utf8")).snapshots.length === 1, "second run for the same date adds nothing");
  // a newer price date appends; history is kept untouched
  const data2 = JSON.parse(fs.readFileSync(path.join(site, "data.json"), "utf8")); data2.dates.push("2099-01-02"); for (const t of Object.keys(data2.prices)) data2.prices[t].push(data2.prices[t][data2.prices[t].length - 1]);
  fs.writeFileSync(path.join(site, "data.json"), JSON.stringify(data2));
  o = run(); log = JSON.parse(fs.readFileSync(path.join(site, "picks_log.json"), "utf8"));
  ok(log.snapshots.length === 2 && log.snapshots[0].date === a.date && log.snapshots[1].date === "2099-01-02", "newer date appends and keeps history");
  // a damaged log stops the run and is NOT overwritten
  fs.writeFileSync(path.join(site, "picks_log.json"), "{not json");
  data2.dates.push("2099-01-03"); for (const t of Object.keys(data2.prices)) data2.prices[t].push(1); fs.writeFileSync(path.join(site, "data.json"), JSON.stringify(data2));
  o = run(); ok(o.status !== 0 && /damaged/.test(o.stderr) && fs.readFileSync(path.join(site, "picks_log.json"), "utf8") === "{not json", "damaged log: stop, do not overwrite");
  fs.writeFileSync(path.join(site, "picks_log.json"), JSON.stringify({ snapshots: "oops" })); o = run(); ok(o.status !== 0 && /unexpected shape/.test(o.stderr), "wrong shape: stop");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(bad ? `FAILED ${bad}` : "scoreboard/picks/snapshot ALL OK"); process.exit(bad ? 1 : 0);
