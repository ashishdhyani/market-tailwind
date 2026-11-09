const H = require("../site/holdings.js");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " got " + JSON.stringify(a));
const known = new Set(["AAPL", "XOM", "D05.SI", "O39.SI", "MSFT"]);

// --- parsing: header CSV, headerless rows, tabs, quoted numbers, $ signs, comments
let r = H.parseHoldings("Symbol,Quantity,Avg Price\nAAPL,10,150.5\nXOM,20,\nD05,100,33.2\n", known);
eq(r.holdings, [{ t: "AAPL", qty: 10, cost: 150.5 }, { t: "XOM", qty: 20, cost: null }, { t: "D05.SI", qty: 100, cost: 33.2 }], "header csv + .SI mapping");
eq(r.rejected, [], "no rejects");
r = H.parseHoldings("# my stocks\nMSFT 5 300\naapl\n$XOM\t8\t99.9", known);
eq(r.holdings, [{ t: "MSFT", qty: 5, cost: 300 }, { t: "AAPL", qty: null, cost: null }, { t: "XOM", qty: 8, cost: 99.9 }], "headerless, comment, $ prefix, tab");
r = H.parseHoldings('Ticker;Shares;Cost\nMSFT;"1,250";"310.40"', known);
eq(r.holdings, [{ t: "MSFT", qty: 1250, cost: 310.4 }], "semicolon + quoted thousands");
r = H.parseHoldings("Shares,Ticker\n10,AAPL\n5,XOM", known);   // header says ticker is the 2nd column
eq(r.holdings.map((h) => [h.t, h.qty]), [["AAPL", 10], ["XOM", 5]], "reordered columns");
r = H.parseHoldings("AAPL 10 100\nAAPL 30 200", known);
eq(r.holdings, [{ t: "AAPL", qty: 40, cost: 175 }], "duplicates add shares and average cost");

// --- broker spellings of class shares map to Yahoo's dash form, and merge with the dash form
const knownB = new Set(["BRK-B", "BF-B", "AAPL"]);
eq(H.parseHoldings("BRK.B,3,420\nBRK-B,5,400\nBF/B 2", knownB).holdings, [{ t: "BRK-B", qty: 8, cost: 407.5 }, { t: "BF-B", qty: 2, cost: null }], "BRK.B / BF/B");
eq(H.parseHoldings("BRK.B 3", new Set()).holdings, [{ t: "BRK.B", qty: 3, cost: null }], "unknown dotted symbol left as typed");

// --- bad input is rejected, never crashes
r = H.parseHoldings("AAPL -5\n123abc 4\nXOM 0\nMSFT 3 -1\n<script>alert(1)</script>\nTOOLONGTICKERSYMBOL1 5", known);
eq(r.holdings, [], "all bad rows dropped");
ok(r.rejected.length === 6, "6 rejects, got " + r.rejected.length);
eq(H.parseHoldings("", known), { holdings: [], rejected: [] }, "empty");
eq(H.parseHoldings(null, known), { holdings: [], rejected: [] }, "null");
ok(H.parseHoldings(Array.from({ length: 300 }, (_, i) => "T" + i + " 1").join("\n"), known).holdings.length === H.MAX_HOLDINGS, "limit " + H.MAX_HOLDINGS);

// --- export round trip
const hs = [{ t: "AAPL", qty: 10, cost: 150.5 }, { t: "XOM", qty: null, cost: null }];
eq(H.parseHoldings(H.toCsv(hs), known).holdings, hs, "csv round trip");

// --- concentration (weights per currency, no FX)
const sm = H.summarize([{ t: "AAPL", value: 600, currency: "USD", group: "Technology" }, { t: "MSFT", value: 200, currency: "USD", group: "Technology" },
  { t: "XOM", value: 200, currency: "USD", group: "Energy" }, { t: "D05.SI", value: 500, currency: "SGD", group: "Financial Services" }, { t: "BAD", value: 0, currency: "USD", group: "X" }]);
const usd = sm.find((s) => s.currency === "USD"), sgd = sm.find((s) => s.currency === "SGD");
ok(usd.total === 1000 && usd.count === 3 && usd.top.t === "AAPL" && Math.abs(usd.top.weight - 0.6) < 1e-12, "usd summary");
ok(usd.groups[0].name === "Technology" && Math.abs(usd.groups[0].weight - 0.8) < 1e-12, "sector split");
ok(sgd.total === 500 && sgd.top.weight === 1, "sgd separate");

// --- rank buckets
eq([1, 5, 6, 15, 16, 30, 31, 45].map((n) => H.rankBucket(n, 45)), ["top 5", "top 5", "top third", "top third", "middle third", "middle third", "bottom third", "bottom third"], "buckets");
ok(H.rankBucket(null, 45) === null, "no rank");

// --- snapshots + diff: descriptive changes only
const entry = (o) => H.snapshotEntry({ trend: "Strong uptrend", rank: { n: 3, of: 45 }, news: { word: "better than most", n: 10 }, fund: "Strong", price: 100, ...o });
const prev = { asOf: "A", items: { AAPL: entry({}), XOM: entry({}), MSFT: entry({}) } };
const cur = { asOf: "B", items: {
  AAPL: entry({ trend: "Mixed trend", price: 93 }),                           // trend down + price -7%
  XOM: entry({ rank: { n: 40, of: 45 }, news: { word: "weaker than most", n: 9 }, fund: "Mixed" }),
  MSFT: entry({ news: { word: "weaker than most", n: 1 }, price: 101 }),       // 1 headline: tone ignored; +1%: ignored
  NEW: entry({}) } };
const d = H.diffSnapshots(prev, cur);
const has = (t, kind, dir) => d.some((c) => c.t === t && c.kind === kind && c.dir === dir);
ok(has("AAPL", "trend", "▼") && has("AAPL", "price", "▼"), "AAPL changes");
ok(has("XOM", "rank", "▼") && has("XOM", "news", "▼") && has("XOM", "fund", "▼"), "XOM changes");
ok(!d.some((c) => c.t === "MSFT") && !d.some((c) => c.t === "NEW"), "no noise for MSFT / new tickers");
ok(d.find((c) => c.kind === "price").text === "Price moved -7.0% since the previous update.", "price text");
ok(!d.some((c) => /\b(buy|sell|hold)\b/i.test(c.text)), "wording never says buy/sell/hold");
const up = H.diffSnapshots(cur, prev);
ok(up.some((c) => c.t === "AAPL" && c.kind === "trend" && c.dir === "▲") && up.some((c) => c.t === "XOM" && c.kind === "rank" && c.dir === "▲"), "improvements point up");
eq(H.diffSnapshots(null, cur), [], "no baseline, no diff");

// --- baseline only rolls when a NEW update arrives (same-day revisits show the same changes)
let st = H.rollSnapshots(null, null, prev); ok(st.seen === null && st.last.asOf === "A", "first visit");
st = H.rollSnapshots(st.last, st.seen, prev); ok(st.seen === null, "same update, still no baseline");
st = H.rollSnapshots(st.last, st.seen, cur); ok(st.seen.asOf === "A" && st.last.asOf === "B", "new update -> baseline is the old one");
st = H.rollSnapshots(st.last, st.seen, cur); ok(st.seen.asOf === "A" && st.last.asOf === "B", "revisit: baseline unchanged");
const cur2 = { asOf: "C", items: cur.items };
st = H.rollSnapshots(st.last, st.seen, cur2); ok(st.seen.asOf === "B", "next update rolls forward");

// ================= cash planner (arithmetic only) =================
const near = (a, b, m) => ok(Math.abs(a - b) < 0.005, m + " got " + a + " want " + b);
const plan = (o) => H.planBasket(o);
const at = (r, t) => pr.rows.find((x) => x.t === t);
const ABC = [{ t: "A", price: 100, weight: null }, { t: "B", price: 250, weight: null }, { t: "C", price: 40, weight: null }];

// parsing the basket: tickers with optional % weights, same ticker normalisation as holdings
const pb = H.parseBasket("NVDA 40\nMSFT, 30%\nXOM\n# note\n<script>\nAAPL 150\nD05 20", new Set(["NVDA", "MSFT", "XOM", "AAPL", "D05.SI"]));
eq(pb.items, [{ t: "NVDA", weight: 40 }, { t: "MSFT", weight: 30 }, { t: "XOM", weight: null }, { t: "D05.SI", weight: 20 }], "basket parse");
ok(pb.rejected.length === 2, "basket rejects: " + JSON.stringify(pb.rejected));

// equal split, whole shares; leftover crumbs go to the most under-filled slot
let pr = plan({ cash: 10000, items: ABC });
ok(at(pr, "A").shares === 34 && at(pr, "B").shares === 13 && at(pr, "C").shares === 83, "equal split shares " + pr.rows.map((x) => x.shares));
near(pr.totals.invested, 9970, "invested"); near(pr.totals.cashLeft, 30, "cash left");
near(pr.totals.invested + pr.totals.cashLeft, 10000, "money adds up");

// cash to keep back is never spent
pr = plan({ cash: 10000, reservePct: 10, items: ABC });
near(pr.totals.invested, 9000, "reserve: invested"); near(pr.totals.cashLeft, 1000, "reserve: left"); near(pr.totals.reserveCash, 1000, "reserve amount");

// fees per order reduce what each slot can buy
pr = plan({ cash: 10000, fee: 5, items: ABC });
ok(at(pr, "A").shares === 34 && at(pr, "B").shares === 13 && at(pr, "C").shares === 83, "fee shares " + pr.rows.map((x) => x.shares));
near(pr.totals.fees, 15, "fees"); near(pr.totals.invested, 9985, "fee: invested"); near(pr.totals.cashLeft, 15, "fee: left");

// explicit weights are percentages (scaled to 100 if they do not add up); blanks split the remainder
pr = plan({ cash: 10000, items: [{ t: "A", price: 100, weight: 50 }, { t: "B", price: 250, weight: 30 }, { t: "C", price: 40, weight: 20 }] });
ok(at(pr, "A").shares === 50 && at(pr, "B").shares === 12 && at(pr, "C").shares === 50, "weights 50/30/20");
near(pr.totals.cashLeft, 0, "weights: nothing left");
pr = plan({ cash: 10000, items: [{ t: "A", price: 100, weight: 20 }, { t: "B", price: 100, weight: 30 }] });  // 20:30 -> 40%:60%
near(at(pr, "A").weight, 40, "scaled weight A"); near(at(pr, "B").weight, 60, "scaled weight B");
pr = plan({ cash: 10000, items: [{ t: "A", price: 100, weight: 50 }, { t: "B", price: 100, weight: null }, { t: "C", price: 100, weight: null }] });
near(at(pr, "B").weight, 25, "blank gets half the remainder"); near(at(pr, "C").weight, 25, "blank gets half the remainder");
ok(plan({ cash: 10000, items: [{ t: "A", price: 100, weight: 70 }, { t: "B", price: 100, weight: 40 }, { t: "C", price: 100, weight: null }] }).error, "weights already above 100 with a blank");

// part shares
pr = plan({ cash: 1000, fractional: true, items: [{ t: "X", price: 300, weight: null }] });
near(at(pr, "X").shares, 3.33, "fractional shares"); near(pr.totals.cashLeft, 1, "fractional left");

// a slot too small for one share says so and keeps its money
pr = plan({ cash: 1000, items: [{ t: "A", price: 100, weight: 90 }, { t: "Z", price: 500, weight: 10 }] });
ok(at(pr, "Z").shares === 0 && /costs more than this slot/.test(at(pr, "Z").note) && pr.warnings.length === 1, "slot too small");
near(at(pr, "A").shares, 9, "A shares"); near(pr.totals.cashLeft, 100, "kept cash");

// bad input is refused with a message, never NaN
for (const bad_ of [{ cash: 0 }, { cash: -5 }, { cash: NaN }, { cash: 100, reservePct: 95 }, { cash: 100, fee: -1 }, { cash: 100, items: [] }, { cash: 100, items: [{ t: "A", price: 0, weight: null }] }]) {
  const e = plan({ items: ABC, ...bad_ });
  ok(typeof e.error === "string" && !e.rows, "refused: " + JSON.stringify(bad_));
}

// randomised invariants: money adds up, the reserve is never touched, whole shares stay whole, nothing negative
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
for (let k = 0; k < 400; k++) {
  const n = 1 + Math.floor(rnd() * 8), items = Array.from({ length: n }, (_, i) => ({ t: "T" + i, price: +(1 + rnd() * 900).toFixed(2), weight: rnd() < 0.5 ? null : +(1 + rnd() * 40).toFixed(1) }));
  const sumGiven = items.reduce((a, i) => a + (i.weight || 0), 0); if (items.some((i) => i.weight == null) && sumGiven >= 99) continue;
  const o = { cash: +(100 + rnd() * 100000).toFixed(2), reservePct: Math.floor(rnd() * 40), fee: rnd() < 0.5 ? 0 : +(rnd() * 10).toFixed(2), fractional: rnd() < 0.3, items };
  const res = plan(o); if (res.error) { bad++; console.log("unexpected error", JSON.stringify(o), res.error); continue; }
  const t = res.totals, spent = res.rows.reduce((a, x) => a + x.cost, 0);
  if (Math.abs(t.invested + t.cashLeft - o.cash) > 0.011) { bad++; console.log("money does not add up", JSON.stringify(o)); }
  if (t.cashLeft < t.reserveCash - 0.011) { bad++; console.log("reserve touched", JSON.stringify(o), t); }
  if (Math.abs(spent - t.invested) > 0.05 * n) { bad++; console.log("rows do not sum", t.invested, spent); }
  if (res.rows.some((x) => x.shares < 0 || x.cost < 0 || (!o.fractional && !Number.isInteger(x.shares)))) { bad++; console.log("bad shares", JSON.stringify(o)); }
  const wsum = res.rows.reduce((a, x) => a + x.weight, 0); if (Math.abs(wsum - 100) > 1e-6) { bad++; console.log("weights do not sum to 100", wsum); }
}

console.log(bad ? `FAILED ${bad}` : "holdings.js ALL OK"); process.exit(bad ? 1 : 0);
