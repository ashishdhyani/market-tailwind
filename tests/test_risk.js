const R = require("../site/risk.js");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b}`);

// tiny deterministic generator so the "random" cases are repeatable
let seed = 20260109; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const N = 800, dates = Array.from({ length: N }, (_, i) => "d" + i);
const path = (rets, first = NaN) => { const p = new Float64Array(rets.length + 1); p[0] = 100; rets.forEach((r, i) => { p[i + 1] = p[i] * (1 + r); }); return p; };
const series = (map) => (t) => map[t];
const rets = (f) => Array.from({ length: N - 1 }, (_, i) => f(i));
const bm = rets(() => 0.0004 + 0.01 * gauss());
const bench = path(bm);

// 1. two identical assets: perfectly correlated, no diversification, two equal slots
{
  const a = rets(() => 0.0003 + 0.02 * gauss()), A = path(a);
  const r = R.riskReport({ positions: [{ t: "A", w: 1 }, { t: "B", w: 1 }], series: series({ A, B: A }), bench, dates });
  near(r.avgCorr, 1, 1e-9, "identical: correlation"); near(r.divRatio, 1, 1e-9, "identical: diversification ratio"); near(r.effN, 2, 1e-9, "identical: effective positions");
  const solo = R.riskReport({ positions: [{ t: "A", w: 1 }], series: series({ A }), bench, dates });
  near(r.vol, solo.vol, 1e-9, "identical: vol equals a single asset"); ok(solo.avgCorr === null && Math.abs(solo.effN - 1) < 1e-12, "single position: no correlation, one position");
  near(r.contributions[0].share + r.contributions[1].share, 1, 1e-9, "risk shares add to 1");
}

// 2. independent assets diversify: the basket swings less than the average of its parts
{
  const A = path(rets(() => 0.0003 + 0.02 * gauss())), B = path(rets(() => 0.0003 + 0.02 * gauss()));
  const r = R.riskReport({ positions: [{ t: "A", w: 0.5 }, { t: "B", w: 0.5 }], series: series({ A, B }), bench, dates });
  ok(Math.abs(r.avgCorr) < 0.15, "independent: correlation near zero " + r.avgCorr);
  ok(r.divRatio > 1.25 && r.divRatio < 1.6, "independent: diversification ratio near sqrt(2) " + r.divRatio);
  near(r.contributions.reduce((s, c) => s + c.share, 0), 1, 1e-9, "risk shares add to 1");
}

// 3. beta: an asset that moves exactly twice as much as the market has beta 2 and loses twice as much in a fall
{
  const A = path(bm.map((x) => 2 * x)), H = path(bm.map((x) => 0.5 * x));
  const r = R.riskReport({ positions: [{ t: "A", w: 1 }], series: series({ A }), bench, dates });
  near(r.beta, 2, 1e-9, "beta 2"); near(r.stress[1].est, -0.40, 1e-9, "-20% market -> -40%"); near(r.stress[0].est, -0.20, 1e-9, "-10% market -> -20%"); near(r.stress[2].est, -0.60, 1e-9, "-30% market -> -60%");
  near(R.riskReport({ positions: [{ t: "H", w: 1 }], series: series({ H }), bench, dates }).beta, 0.5, 1e-9, "beta 0.5");
  // a 50/50 mix of beta 2 and beta 0.5 has beta 1.25
  near(R.riskReport({ positions: [{ t: "A", w: 1 }, { t: "H", w: 1 }], series: series({ A, H }), bench, dates }).beta, 1.25, 1e-9, "mixed beta");
}

// 4. maximum drawdown: up 20%, down 25%, flat: the peak-to-trough fall is exactly 25%
{
  const r0 = rets(() => 0); r0[100] = 0.20; r0[110] = -0.25;
  const r = R.riskReport({ positions: [{ t: "A", w: 1 }], series: series({ A: path(r0) }), bench: null, dates });
  near(r.maxDD, -0.25, 1e-9, "max drawdown"); ok(r.beta === null && r.stress.length === 0 && r.benchVol === null, "no benchmark: no beta, no stress");
}

// 5. worst month, and the replay of the market's worst stretch
{
  const m = rets(() => 0.0002), a = rets(() => 0.0002);
  for (let i = 300; i < 321; i++) { m[i] = -0.02; a[i] = -0.01; }                // the market falls 2% a day for 21 days; our asset 1% a day
  const r = R.riskReport({ positions: [{ t: "A", w: 1 }], series: series({ A: path(a) }), bench: path(m), dates });
  near(r.worst21, Math.pow(0.99, 21) - 1, 1e-9, "worst month"); near(r.benchWorst21, Math.pow(0.98, 21) - 1, 1e-9, "market worst month");
  const rep = r.replays[0];
  ok(rep.label === "Worst month for the market" && rep.from === "d301" && rep.to === "d321", "replay dates " + rep.from + " " + rep.to);   // returns[i] belongs to date i+1
  near(rep.basket, Math.pow(0.99, 21) - 1, 1e-9, "replay: basket"); near(rep.bench, Math.pow(0.98, 21) - 1, 1e-9, "replay: market");
}

// 6. weights are relative; a zero-variance asset does not break anything
{
  const A = path(rets(() => 0.0003 + 0.02 * gauss())), flat = path(rets(() => 0));
  const a = R.riskReport({ positions: [{ t: "A", w: 2 }, { t: "F", w: 2 }], series: series({ A, F: flat }), bench, dates });
  const b = R.riskReport({ positions: [{ t: "A", w: 0.5 }, { t: "F", w: 0.5 }], series: series({ A, F: flat }), bench, dates });
  near(a.vol, b.vol, 1e-12, "weights are relative");
  ok([a.vol, a.maxDD, a.beta, a.divRatio, a.effN].every(Number.isFinite) && a.avgCorr === null, "flat asset: finite numbers, correlation skipped");
  near(a.vol, 0.5 * R.riskReport({ positions: [{ t: "A", w: 1 }], series: series({ A }), bench, dates }).vol, 1e-9, "half in a flat asset halves the swings");
}

// 7. short history limits the window and is named; too little history is refused with a reason
{
  const A = path(rets(() => 0.0003 + 0.02 * gauss())), Bfull = path(rets(() => 0.0003 + 0.02 * gauss()));
  const B = Float64Array.from(Bfull); for (let i = 0; i < 600; i++) B[i] = NaN;       // B only has data for the last 200 days
  const ok1 = R.riskReport({ positions: [{ t: "A", w: 1 }, { t: "B", w: 1 }], series: series({ A, B }), bench, dates });
  ok(!ok1.error && ok1.days === 199 && ok1.limiting === "B", "limited window: " + (ok1.error || ok1.days + " " + ok1.limiting));
  const B2 = Float64Array.from(Bfull); for (let i = 0; i < 740; i++) B2[i] = NaN;     // only 60 days
  const e = R.riskReport({ positions: [{ t: "A", w: 1 }, { t: "NEW", w: 1 }], series: series({ A, NEW: B2 }), bench, dates });
  ok(/Not enough shared price history/.test(e.error) && /NEW/.test(e.error), "too short: " + e.error);
}

// 8. gaps in the middle (a holiday on one market) just skip those days
{
  const A = path(rets(() => 0.0003 + 0.02 * gauss())); const G = Float64Array.from(A); G[400] = NaN; G[401] = NaN;
  const r = R.riskReport({ positions: [{ t: "G", w: 1 }], series: series({ G }), bench, dates });
  ok(!r.error && r.days <= 753 && Number.isFinite(r.vol), "gap handling: " + (r.error || r.days));
}

// 9. bad input is explained, never NaN
ok(R.riskReport({ positions: [], series: series({}), bench, dates }).error, "no positions");
ok(R.riskReport({ positions: [{ t: "A", w: 0 }], series: series({ A: path(bm) }), bench, dates }).error, "zero weights");
ok(/No price history for X/.test(R.riskReport({ positions: [{ t: "X", w: 1 }], series: series({}), bench, dates }).error), "missing series named");

// 10. real data: a basket of real stocks gives sane numbers
const d = require("../site/data.json");
const real = {}; for (const [t, v] of Object.entries(d.prices)) real[t] = Float64Array.from(v, (x) => (x === null ? NaN : x));
const rr = R.riskReport({ positions: ["AAPL", "XOM", "JPM", "LLY", "KO"].map((t) => ({ t, w: 1 })), series: (t) => real[t], bench: real.SPY, dates: d.dates });
ok(!rr.error && rr.days > 600 && rr.vol > 0.05 && rr.vol < 0.6 && rr.maxDD < 0 && rr.maxDD > -0.9 && rr.beta > 0.2 && rr.beta < 2 && Math.abs(rr.effN - 5) < 1e-9, "real basket sane: " + JSON.stringify({ days: rr.days, vol: rr.vol, maxDD: rr.maxDD, beta: rr.beta }));
near(rr.contributions.reduce((s, c) => s + c.share, 0), 1, 1e-9, "real: risk shares add to 1");
console.log(`  real 5-stock basket: vol ${(rr.vol * 100).toFixed(1)}% vs SPY ${(rr.benchVol * 100).toFixed(1)}%, max drawdown ${(rr.maxDD * 100).toFixed(1)}%, beta ${rr.beta.toFixed(2)}, avg correlation ${rr.avgCorr.toFixed(2)}, window ${rr.from} to ${rr.to}`);
console.log(bad ? `FAILED ${bad}` : "risk.js ALL OK"); process.exit(bad ? 1 : 0);
