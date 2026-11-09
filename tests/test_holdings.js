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

console.log(bad ? `FAILED ${bad}` : "holdings.js ALL OK"); process.exit(bad ? 1 : 0);
