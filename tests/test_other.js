const O = require("../site/other.js");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const near = (a, b, m, tol = 1e-9) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b}`);
const known = new Set(["SPY", "EEM", "URTH", "BNDW", "AGG"]);
const base = { name: "My fund", currency: "SGD", value: "10,000.50", invested: 9000, mix: { equity: 1 }, proxy: { SPY: 1 }, updated: "2026-10-01" };

// ---- normalize: cleans, validates, never trusts input
let r = O.normalize(base, known);
ok(!r.error && r.item.value === 10000.5 && r.item.invested === 9000 && r.item.currency === "SGD" && r.item.proxy.SPY === 1 && r.item.id.length >= 4, "good item: " + JSON.stringify(r));
ok(O.normalize({ ...base, name: "  " }, known).error, "name required");
ok(O.normalize({ ...base, name: "<img src=x onerror=1>Fund\n\u0000" }, known).item.name === "img src=x onerror=1Fund", "markup characters and control characters stripped");
ok(O.normalize({ ...base, name: "x".repeat(500) }, known).item.name.length === 90, "name length capped");
for (const v of [0, -5, "abc", NaN, null, 1e15, ""]) ok(O.normalize({ ...base, value: v }, known).error, "bad value " + v);
ok(O.normalize({ ...base, currency: "EUR" }, known).error, "currency must be SGD or USD");
ok(O.normalize({ ...base, invested: -1 }, known).error && O.normalize({ ...base, invested: null }, known).item.invested === null && O.normalize({ ...base, invested: "" }, known).item.invested === null, "invested optional, never negative");
ok(O.normalize({ ...base, proxy: { NOPE: 1 } }, known).error, "unknown stand-in refused");
const mixed = O.normalize({ ...base, proxy: { SPY: 1, NOPE: 5 } }, known).item; ok(Object.keys(mixed.proxy).join() === "SPY" && mixed.proxy.SPY === 1, "unknown stand-ins dropped, the rest rescaled");
ok(O.normalize({ ...base, proxy: { URTH: 2, BNDW: 3 } }, known).item.proxy.URTH === 0.4, "stand-in weights normalised to 1");
near(O.normalize({ ...base, mix: { equity: 2, bond: 6 } }, known).item.mix.bond, 0.75, "mix normalised");
ok(O.normalize({ ...base, mix: { bogus: 1 } }, known).item.mix.equity === 1, "empty / invalid mix defaults to equity");
ok(O.normalize(null, known).error && O.normalize("x", known).error && O.normalize({}, known).error, "non-objects refused");
ok(O.normalize({ ...base, proxy: undefined }, known).item.proxy === null, "no stand-in is fine");
ok(O.normalize({ ...base, history: [{ date: "2026-09-01", value: 8000 }, { date: "bad", value: 1 }, { date: "2026-08-01", value: -3 }, { date: "2026-08-15", value: "7,500" }, null] }, known).item.history.map((h) => h.date).join() === "2026-08-15,2026-09-01", "history cleaned and sorted");

// ---- addPoint: dated history; same date replaces; value/updated follow the latest point
let it = O.normalize(base, known).item;
it = O.addPoint(it, { date: "2026-11-01", value: 11000, invested: 9500 });
ok(it.value === 11000 && it.invested === 9500 && it.updated === "2026-11-01" && it.history.length === 1, "first point");
it = O.addPoint(it, { date: "2026-11-01", value: 11200 }); ok(it.history.length === 1 && it.value === 11200 && it.invested === 9500, "same date replaces; invested kept when not given");
it = O.addPoint(it, { date: "2026-12-01", value: 12000, invested: null }); ok(it.history.length === 2 && it.invested === null && it.updated === "2026-12-01", "later point appends; invested can be cleared");
it = O.addPoint(it, { date: "2026-10-15", value: 10000 }); ok(it.history.map((h) => h.date).join() === "2026-10-15,2026-11-01,2026-12-01" && it.value === 12000, "an older point is inserted in order and does not become 'current'");
ok(O.addPoint(it, { date: "nope", value: 5 }) === it && O.addPoint(it, { date: "2026-12-02", value: -5 }) === it, "invalid points are ignored");
let big = O.normalize(base, known).item; for (let i = 0; i < 500; i++) big = O.addPoint(big, { date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), value: 1000 + i }); ok(big.history.length === 400, "history capped at 400");

// ---- age / staleness
const NOW = Date.UTC(2026, 10, 9, 15);
ok(O.ageDays("2026-11-09", NOW) === 0 && O.ageDays("2026-10-10", NOW) === 30 && O.ageDays("garbage", NOW) === null, "ageDays");
ok(O.staleness("2026-11-01", NOW) === "fresh" && O.staleness("2026-09-30", NOW) === "stale" && O.staleness("2026-07-01", NOW) === "very" && O.staleness(null, NOW) === "unknown", "staleness bands");

// ---- blended stand-in series
const n = 10, dates = Array.from({ length: n }, (_, i) => "2026-10-" + String(1 + i).padStart(2, "0"));
const mk = (rates) => { const p = new Float64Array(n); p[0] = 50; for (let i = 1; i < n; i++) p[i] = p[i - 1] * (1 + rates[i - 1]); return p; };
const A = mk(Array(n - 1).fill(0.01)), B = mk(Array(n - 1).fill(-0.005)), get = (t) => ({ A, B })[t];
let b = O.blendSeries({ A: 1 }, get, n); near(b[0], 100, "blend starts at 100"); near(b[n - 1], 100 * Math.pow(1.01, n - 1), "single stand-in tracks it");
b = O.blendSeries({ A: 0.4, B: 0.6 }, get, n); near(b[n - 1], 100 * Math.pow(1 + 0.4 * 0.01 - 0.6 * 0.005, n - 1), "40/60 blend compounds the weighted daily return");
ok(O.blendSeries({ A: 1, MISSING: 1 }, get, n) === null && O.blendSeries(null, get, n) === null && O.blendSeries({}, get, n) === null && O.blendSeries({ A: 1 }, () => new Float64Array(3), n) === null, "missing / misaligned stand-ins -> null");
{ const Ag = Float64Array.from(A); Ag[4] = NaN; const g = O.blendSeries({ A: 1 }, () => Ag, n); ok(g.every(Number.isFinite), "a gap in the data does not poison the path"); }

// ---- estimate: last value moved by the stand-in since the date it was entered
b = O.blendSeries({ A: 1 }, get, n);
let e = O.estimate({ value: 1000, updated: "2026-10-04" }, b, dates);   // idx 3; last idx 9 -> 6 days of +1%
near(e.estimated, 1000 * Math.pow(1.01, 6), "estimate", 1e-6); near(e.sinceUpdate, Math.pow(1.01, 6) - 1, "since update", 1e-9); ok(e.days === 6 && e.asOf === "2026-10-10", "days / asOf");
ok(O.estimate({ value: 1000, updated: "2026-10-10" }, b, dates).estimated === 1000, "entered on the last price date: no move");
near(O.estimate({ value: 1000, updated: "2026-11-30" }, b, dates).estimated, 1000, "entered after the last price date: no move");
ok(O.estimate({ value: 1000, updated: "2026-09-01" }, b, dates) === null, "entered before our history starts: no estimate");
ok(O.estimate({ value: 1000, updated: null }, b, dates) === null && O.estimate({ value: 1000, updated: "2026-10-04" }, null, dates) === null, "no date / no stand-in -> null");
near(O.estimate({ value: 1000, updated: "2026-10-04" }, O.blendSeries({ B: 1 }, get, n), dates).estimated, 1000 * Math.pow(0.995, 6), "falling stand-in lowers the estimate", 1e-6);

// ---- gain
ok(O.gain(11000, 10000).amount === 1000 && Math.abs(O.gain(11000, 10000).pct - 0.1) < 1e-12 && O.gain(5, 0) === null && O.gain(5, null) === null, "gain");

// ---- classify directly-held funds
const cl = O.classifyHolding;
ok(cl(null) === "equity" && cl({ type: "EQUITY" }) === "equity" && cl({ type: "ETF", category: "Large Blend" }) === "equity", "stocks and equity ETFs");
ok(cl({ type: "ETF", category: "Intermediate Core Bond" }) === "bond" && cl({ type: "ETF", category: "Long Government" }) === "bond" && cl({ type: "ETF", category: "High Yield Bond" }) === "bond" && cl({ type: "ETF", category: "Global Bond-USD Hedged" }) === "bond", "bond ETFs");
ok(cl({ type: "ETF", category: "Derivative Income" }) === "equity", "'income' alone does not make it a bond fund");
ok(cl({ type: "ETF", category: "Commodities Focused" }) === "other" && cl({ type: "ETF", category: "Digital Assets" }) === "other" && cl({ type: "ETF", category: "Ultrashort Bond" }) === "cash", "commodity / crypto / cash");

// ---- allocation by currency, splitting mixed funds
const al = O.allocate([{ currency: "SGD", value: 1000, mix: { equity: 0.4, bond: 0.6 } }, { currency: "SGD", value: 1000, mix: { equity: 1 } }, { currency: "USD", value: 500, mix: { bond: 1 } }, { currency: "SGD", value: 0, mix: { equity: 1 } }]);
near(al.SGD.total, 2000, "SGD total"); near(al.SGD.equity, 1400, "SGD equity"); near(al.SGD.bond, 600, "SGD bond"); near(al.USD.bond, 500, "USD bond"); ok(al.USD.equity === 0, "no equity in USD");
near(al.SGD.equity + al.SGD.bond + al.SGD.cash + al.SGD.other, al.SGD.total, "classes add up to the total");

// ---- presets are valid, use only known stand-ins, and mixes add up
for (const p of O.PRESETS) {
  const x = O.normalize({ ...p, currency: "SGD", value: 100 }, known);
  ok(!x.error && Object.keys(x.item.proxy).every((t) => known.has(t)), "preset valid: " + p.name + " " + (x.error || ""));
}
const fl = O.PRESETS.find((p) => p.key === "flagship"); ok(fl.mix.equity === 0.4 && fl.mix.bond === 0.6 && fl.proxy.URTH === 0.4 && fl.proxy.BNDW === 0.6, "Flagship Measured is 40% equities / 60% fixed income");
ok(O.PRESETS.length === 4 && O.PRESETS.map((p) => p.key).join() === "us500,em,world,flagship", "the four Endowus holdings");

// ---- real data: stand-ins exist and a blend behaves sensibly
const d = require("../site/data.json"), real = (t) => (d.prices[t] ? Float64Array.from(d.prices[t], (x) => (x === null ? NaN : x)) : undefined);
ok(d.reference.includes("URTH") && d.reference.includes("BNDW"), "reference tickers exported");
for (const p of O.PRESETS) { const bl = O.blendSeries(p.proxy, real, d.dates.length); ok(bl && bl.every(Number.isFinite) && bl[bl.length - 1] > 0, "real blend for " + p.key); }
const flag = O.blendSeries(O.PRESETS[3].proxy, real, d.dates.length), world = O.blendSeries(O.PRESETS[2].proxy, real, d.dates.length);
const vol = (s) => { const r = []; for (let i = 1; i < s.length; i++) r.push(s[i] / s[i - 1] - 1); const m = r.reduce((a, x) => a + x, 0) / r.length; return Math.sqrt(r.reduce((a, x) => a + (x - m) * (x - m), 0) / (r.length - 1)) * Math.sqrt(252); };
ok(vol(flag) < vol(world) * 0.8, `the 40/60 portfolio swings clearly less than the all-equity one: ${(vol(flag) * 100).toFixed(1)}% vs ${(vol(world) * 100).toFixed(1)}%`);
console.log(`  stand-in volatility: MSCI World ${(vol(world) * 100).toFixed(1)}%, Flagship 40/60 blend ${(vol(flag) * 100).toFixed(1)}%`);
console.log(bad ? `FAILED ${bad}` : "other.js ALL OK"); process.exit(bad ? 1 : 0);
