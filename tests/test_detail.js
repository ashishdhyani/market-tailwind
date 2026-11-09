const D = require("../site/detail.js"), E = require("../site/engine.js");
const fund = require("../site/fundamentals.json").items, news = require("../site/news.json");
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };

// Real data end to end: every sector ticker builds a panel in every horizon, in both modes
const d = JSON.parse(require("fs").readFileSync(__dirname + "/../site/data.json"));
const series = {};
for (const [t, v] of Object.entries(d.prices)) series[t] = Float64Array.from(v, (x) => (x === null ? NaN : x));
const sd = E.deriveSectorData(d, (t) => series[t]);
let built = 0;
for (const h of Object.keys(E.HORIZONS)) {
  const res = E.sectorAnalysis(sd, news, h);
  for (const s of res.sectors) {
    const sector = { name: s.name, rank: s.rank, of: res.sectors.length, etf: s.etf, etfRet: s.etfRow.ret_21, retLabel: "1 month", final: s.final };
    const etf = D.buildDetail({ ticker: s.etf, info: fund[s.etf], price: s.etfRow.price, row: { ...s.etfRow, final: s.final }, horizon: h, mode: "sector", sector, stockRank: { k: 0, of: 6 }, news: null });
    ok(/Why it is recommended/.test(etf) && /Fund numbers/.test(etf), "etf panel " + s.etf);
    s.stocks.forEach((r, i) => {
      const html = D.buildDetail({ ticker: r.ticker, info: fund[r.ticker], price: r.price, row: r, horizon: h, mode: "sector", sector, stockRank: { k: i + 1, of: s.stocks.length }, news: { n: 3, avg: 0.2, z: r.newsZ, items: s.headlines.slice(0, 3) } });
      // with fundamentals: the key-numbers grid; without (a few tickers always lack them): the explicit fallback line
      ok(fund[r.ticker] ? /Key numbers investors look at/.test(html) : /No fundamentals data available/.test(html), "stock panel " + r.ticker);
      ok(/Why it is recommended/.test(html) && /News:/.test(html), "stock panel sections " + r.ticker);
      built++;
    });
  }
}

// Loss warning banner: shown for a company that reports a loss, never for a profitable one or an ETF
const lossHtml = D.buildDetail({ ticker: "L", info: { name: "Loss Co", type: "EQUITY", sector: "Health Care", roe: -0.345, net_margin: -1.1, fwd_pe: -50 }, price: 10, row: null, horizon: "long", mode: "rank", news: null });
ok(/class="warn-banner"/.test(lossHtml) && /Reports a loss: ROE -35%, net margin -110%/.test(lossHtml), "loss banner");
const okHtml = D.buildDetail({ ticker: "P", info: { name: "Profit Co", type: "EQUITY", sector: "Energy", roe: 0.2, net_margin: 0.1, fwd_pe: 12 }, price: 10, row: null, horizon: "long", mode: "rank", news: null });
ok(!/warn-banner/.test(okHtml), "no banner for a profitable company");
const etfHtml = D.buildDetail({ ticker: "E", info: { name: "Some ETF", type: "ETF", roe: -1 }, price: 10, row: null, horizon: "long", mode: "rank", news: null });
ok(!/warn-banner/.test(etfHtml), "no banner for an ETF");
const hold = D.buildDetail({ ticker: "L", info: { name: "Loss Co", type: "EQUITY", roe: -0.1 }, price: 10, row: null, horizon: "long", mode: "holding", news: null });
ok(/warn-banner/.test(hold), "banner also in the holdings view");

// "Coming up" line: only for upcoming dates, with a caution when earnings are close
const NOW2 = Date.UTC(2026, 10, 9, 15, 0);
const evHtml = D.buildDetail({ ticker: "E", info: { name: "Event Co", type: "EQUITY", next_earnings: "2026-11-12", ex_div: "2026-11-20" }, price: 10, row: null, horizon: "long", mode: "rank", news: null, now: NOW2 });
ok(/Coming up:<\/b> Earnings around 12 Nov \(in 3 days\); Ex-dividend around 20 Nov \(in 11 days\)\. Results often move a stock sharply either way/.test(evHtml), "coming up line: " + (evHtml.match(/Coming up:.{0,160}/) || [""])[0]);
const farHtml = D.buildDetail({ ticker: "E", info: { name: "Event Co", type: "EQUITY", next_earnings: "2027-01-28" }, price: 10, row: null, horizon: "long", mode: "rank", news: null, now: NOW2 });
ok(/Coming up:/.test(farHtml) && !/sharply either way/.test(farHtml), "far-away earnings: listed without the caution");
const pastHtml = D.buildDetail({ ticker: "E", info: { name: "Event Co", type: "EQUITY", next_earnings: "2026-11-02" }, price: 10, row: null, horizon: "long", mode: "rank", news: null, now: NOW2 });
ok(!/Coming up:/.test(pastHtml), "past dates produce no line");

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
