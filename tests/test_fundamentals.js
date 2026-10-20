const F = require("../site/fundamentals.js");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const st = (ev, k) => ev.metrics.find((m) => m.key === k)?.status;

// A cheap, high-quality company
let e = F.evaluate({ name: "Good Co", type: "EQUITY", sector: "Energy", currency: "USD", mcap: 8e10, fwd_pe: 9.8, peg: 0.9, roe: 0.22,
  net_margin: 0.25, rev_growth: 0.15, earn_growth: 0.3, de: 0.2, fcf: 4e9, rec: 2.0, target: 120, analysts: 20, hi52: 110, lo52: 70, div_yield: 0.026 }, 100);
ok(st(e, "fwd_pe") === "good" && st(e, "peg") === "good" && st(e, "roe") === "good", "good statuses");
ok(Math.abs(e.metrics.find((m) => m.key === "fcf_yield").value - 0.05) < 1e-12, "fcf yield derived");
ok(e.summary.good === 8 && e.summary.of === 8 && e.summary.label === "Strong", "summary strong " + JSON.stringify(e.summary));
ok(e.strengths.length === 8 && e.cautions.length === 0, "strengths");
ok(st(e, "target") === "good" && /\+20%/.test(e.metrics.find((m) => m.key === "target").text), "target upside");

// An expensive, loss-making company
let b = F.evaluate({ name: "Bad Co", type: "EQUITY", sector: "Technology", currency: "USD", mcap: 1e9, fwd_pe: -5, roe: -0.1, net_margin: -0.2,
  rev_growth: -0.05, earn_growth: -0.5, de: 3, fcf: -1e8 }, 10);
ok(st(b, "fwd_pe") === "bad" && b.metrics.find((m) => m.key === "fwd_pe").text === "Negative", "negative PE is bad");
ok(b.summary.label === "Weak" && b.cautions.length >= 5, "weak " + JSON.stringify(b.summary));

// Banks: debt and FCF checks are skipped, not failed
let bank = F.evaluate({ name: "Bank", type: "EQUITY", sector: "Financial Services", fwd_pe: 14, roe: 0.16, net_margin: 0.5, rev_growth: 0.07, de: 5, fcf: -1e9, mcap: 2e11 }, 50);
ok(st(bank, "de") === "na" && st(bank, "fcf_yield") === "na", "bank skips");
ok(bank.summary.of === 4, "bank counts only applicable core checks: " + bank.summary.of);

// Utilities get a relaxed debt threshold
ok(st(F.evaluate({ name: "U", type: "EQUITY", sector: "Utilities", de: 1.1, fwd_pe: 18, roe: 0.1, net_margin: 0.1, rev_growth: 0.05 }, 10), "de") === "good", "utility debt");

// Sparse data -> no verdict, no crash
ok(F.evaluate({ name: "Sparse", type: "EQUITY", sector: "Energy" }, 10).summary.label === "Not enough data", "sparse");
ok(F.evaluate(undefined, 10) === null, "undefined");

// ETF
let etf = F.evaluate({ name: "Sector ETF", type: "ETF", currency: "USD", expense: 0.0008, aum: 3.9e10, div_yield: 0.0248, pe: 19.3, hi52: 68, lo52: 43, category: "Equity Energy" }, 67);
ok(etf.summary === null && st(etf, "expense") === "good" && st(etf, "aum") === "good" && etf.facts[0] === "Equity Energy", "etf");

ok(F.brief({ type: "EQUITY", fwd_pe: 9.75, roe: 0.225, rev_growth: 0.587 }) === "Fwd P/E 9.8× · ROE 23% · Rev +59%", "brief: " + F.brief({ type: "EQUITY", fwd_pe: 9.75, roe: 0.225, rev_growth: 0.587 }));
ok(F.money(8.2309e10, "USD") === "$82.3B" && F.money(2.1168e11, "SGD") === "S$212B" && F.money(12.5, "USD") === "$12.50", "money " + F.money(2.1168e11, "SGD"));

// every real ticker evaluates without throwing
const fd = require("../site/fundamentals.json").items;
let n = 0; for (const [t, i] of Object.entries(fd)) { try { F.evaluate(i, i.hi52 ? (i.hi52 + i.lo52) / 2 : 10); n++; } catch (x) { bad++; console.log("THROW", t, x.message); } }
console.log(bad ? `FAILED ${bad}` : `fundamentals.js ALL OK (${n} real tickers evaluated)`); process.exit(bad ? 1 : 0);
