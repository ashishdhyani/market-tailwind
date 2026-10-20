const D = require("../site/detail.js"), E = require("../site/engine.js");
const fund = require("../site/fundamentals.json").items, news = require("../site/news.json");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };

// Real data end to end: every sector ticker builds a panel in every horizon, in both modes
const sd = JSON.parse(require("fs").readFileSync(__dirname + "/../site/sector_data.json"));
for (const k of Object.keys(sd.prices)) sd.prices[k] = Float64Array.from(sd.prices[k], (v) => (v === null ? NaN : v));
let built = 0;
for (const h of Object.keys(E.HORIZONS)) {
  const res = E.sectorAnalysis(sd, news, h);
  for (const s of res.sectors) {
    const sector = { name: s.name, rank: s.rank, of: res.sectors.length, etf: s.etf, etfRet: s.etfRow.ret_21, retLabel: "1 month", final: s.final };
    const etf = D.buildDetail({ ticker: s.etf, info: fund[s.etf], price: s.etfRow.price, row: { ...s.etfRow, final: s.final }, horizon: h, mode: "sector", sector, stockRank: { k: 0, of: 6 }, news: null });
    ok(/Why it is recommended/.test(etf) && /Fund numbers/.test(etf), "etf panel " + s.etf);
    s.stocks.forEach((r, i) => {
      const html = D.buildDetail({ ticker: r.ticker, info: fund[r.ticker], price: r.price, row: r, horizon: h, mode: "sector", sector, stockRank: { k: i + 1, of: s.stocks.length }, news: { n: 3, avg: 0.2, z: r.newsZ, items: s.headlines.slice(0, 3) } });
      ok(/Key numbers investors look at/.test(html) && /Fundamentals check/.test(html), "stock panel " + r.ticker);
      built++;
    });
  }
}

// Untrusted text is escaped; non-http links are neutralised
const evil = D.buildDetail({ ticker: "X", info: { name: '<img src=x onerror=alert(1)>', type: "EQUITY", sector: "Energy", fwd_pe: 10 }, price: 10, row: null, horizon: "long", mode: "rank",
  news: { n: 1, avg: 0.5, z: null, items: [{ title: '<script>alert(1)</script>', url: "javascript:alert(1)", time: new Date().toISOString(), score: 0.5, tickers: ["X"] }] } });
ok(!/<img|<script/i.test(evil), "html escaped");
ok(!/href="javascript:/i.test(evil), "javascript: url blocked");
ok(/&lt;script&gt;/.test(evil), "title shown as text");

// Missing data degrades gracefully
const none = D.buildDetail({ ticker: "Z", info: undefined, price: null, row: null, horizon: "long", mode: "rank", news: null });
ok(/No fundamentals data available/.test(none) && /no recent headlines/i.test(none), "missing data");
console.log(bad ? `FAILED ${bad}` : `detail.js ALL OK (${built} stock panels + ETF panels across ${Object.keys(E.HORIZONS).length} horizons)`); process.exit(bad ? 1 : 0);
