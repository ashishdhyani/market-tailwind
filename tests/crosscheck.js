// Usage: node tests/crosscheck.js <python-output.json>
const fs = require("fs"), E = require("../site/engine.js");
const py = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/\bNaN\b/g, "null"));
const d = JSON.parse(fs.readFileSync(__dirname + "/../site/data.json"));
const arr = (t) => Float64Array.from(d.prices[t], (v) => (v === null ? NaN : v));
const tick = d.watchlist, P = tick.map(arr), F = P.map(E.featuresFor), n = d.dates.length;
const B = Object.fromEntries(Object.keys(d.benchmarks).map((t) => [t, arr(t)]));
let bad = 0;
const chk = (name, a, b, tol = 1e-6) => { if (!(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)))) { bad++; console.log("MISMATCH", name, a, b); } };

const lt = E.latestTable(tick, P, F, n);
chk("asof", Date.parse(d.dates[lt.asofIndex]), Date.parse(py.table.asof), 0);
chk("rows", lt.rows.length, py.table.rows.length, 0);
py.table.rows.forEach(([t, rank, score, price, why], i) => {
  const r = lt.rows[i];
  if (r.ticker !== t) { bad++; console.log("RANK MISMATCH", i, r.ticker, t); return; }
  chk(t + " score", r.score, score); chk(t + " price", r.price, price);
  if (E.explain(r) !== why) { bad++; console.log("TEXT MISMATCH", E.explain(r), "|", why); }
});
console.log("rankings checked:", lt.rows.length, "as of", d.dates[lt.asofIndex]);

for (const [key, [topN, cost]] of [["bt_5_10", [5, 10]], ["bt_8_25", [8, 25]]]) {
  const r = E.runBacktest(d.dates, P, F, B, topN, cost), p = py[key];
  chk(key + " n", r.dates.length, p.n, 0);
  for (const [name, m] of Object.entries(p.metrics)) {
    const mine = r.metrics[name];
    if (!mine) { bad++; console.log("missing series", name); continue; }
    for (const [k, v] of Object.entries(m)) if (v !== null && !Number.isNaN(v)) chk(`${key} ${name} ${k}`, mine[k], v, 1e-6);
    chk(`${key} ${name} end`, r.equity[name][r.dates.length - 1], p.end[name]);
    p.yearly[name].forEach((v, i) => chk(`${key} ${name} ${r.yearly.years[i]}`, r.yearly.values[name][i], v));
  }
  console.log(key, "checked", Object.keys(p.metrics).length, "series,", r.dates.length, "days");
}

for (const [h, p] of Object.entries(py.short)) {
  const lt2 = E.latestTable(tick, P, F, n, h);
  chk(`${h} asof`, Date.parse(d.dates[lt2.asofIndex]), Date.parse(p.asof), 0);
  chk(`${h} count`, lt2.rows.length, p.rank.length, 0);
  p.rank.forEach((t, i) => {
    if (lt2.rows[i].ticker !== t) { bad++; console.log("SHORT RANK MISMATCH", h, i, lt2.rows[i].ticker, t); return; }
    chk(`${h} ${t} score`, lt2.rows[i].score, p.score[i]);
  });
  const r = E.runBacktest(d.dates, P, F, B, 5, 10, 1, h);
  chk(`${h} n`, r.dates.length, p.n, 0);
  for (const [name, m] of Object.entries(p.metrics)) {
    for (const [k, v] of Object.entries(m)) if (v !== null && !Number.isNaN(v)) chk(`${h} ${name} ${k}`, r.metrics[name][k], v, 1e-6);
    chk(`${h} ${name} end`, r.equity[name][r.dates.length - 1], p.end[name]);
  }
  console.log(h, "checked: ranking of", p.rank.length, "and backtest", r.dates.length, "days");
}
console.log(bad ? `FAILED: ${bad} mismatches` : "ALL MATCH");
process.exit(bad ? 1 : 0);
