/* The app's default picks, as a pure function of the data files. Used by tools/snapshot_picks.mjs, which records
   them every refresh so the Scoreboard can later measure how those exact lists did. No DOM, no network.

   Default settings only (everything switched on, no loss filter): the Scoreboard tracks what the app shows by
   default, not what anyone could have selected afterwards. */
(function (root) {
  "use strict";
  const req = typeof require !== "undefined";
  const E = req ? require("./engine.js") : root.Engine;
  const P = req ? require("./pullbacks.js") : root.Pullbacks;

  const TOP = 5;
  const LISTS = [
    ...Object.entries(E.HORIZONS).map(([h, v]) => ({ key: `rank:${h}`, label: `Rankings top ${TOP}: ${v.label}` })),
    { key: "pullbacks:1m", label: `Pullbacks top ${TOP}: fell 10%+ in a month` },
    { key: "sectors:leaders", label: "Leader of each of the top 3 sectors" },
  ];

  const toF64 = (a) => Float64Array.from(a, (v) => (v === null ? NaN : v));
  const parseGen = (g) => { const t = Date.parse(String(g || "").replace(" UTC", "Z").replace(" ", "T")); return Number.isNaN(t) ? Date.now() : t; };

  /* data: parsed data.json; fund: fundamentals.json items; news: parsed news.json (or null).
     Returns { date, universe, lists: { key: [tickers] } }. */
  function buildLists({ data, fund, news }) {
    const dates = data.dates, n = dates.length;
    const series = {}, feats = {};
    for (const t of Object.keys(data.prices)) series[t] = toF64(data.prices[t]);
    for (const t of data.watchlist) feats[t] = E.featuresFor(series[t]);

    const tickers = data.watchlist;
    const lists = {};
    for (const h of Object.keys(E.HORIZONS)) {
      try {
        lists[`rank:${h}`] = E.latestTable(tickers, tickers.map((t) => series[t]), tickers.map((t) => feats[t]), n, h).rows.slice(0, TOP).map((r) => r.ticker);
      } catch { lists[`rank:${h}`] = []; }
    }

    // Sector view (long-term), also the source of each stock's news tone relative to the others
    const sd = E.deriveSectorData(data, (t) => series[t]);
    const sec = E.sectorAnalysis(sd, news || { generated: data.generated, items: [] }, "long");
    lists["sectors:leaders"] = sec.sectors.slice(0, 3).map((s) => s.stocks[0] && s.stocks[0].ticker).filter(Boolean);
    const zOf = new Map(sec.sectors.flatMap((s) => s.stocks.map((r) => [r.ticker, r.newsZ])));

    // Pullbacks: stocks only (funds have no company data), same rules as the Pullbacks tab
    const asOf = parseGen(news && news.generated);
    const cands = [];
    for (const t of tickers) {
      const info = fund[t];
      if (!info || info.type === "ETF") continue;
      const p = series[t], f = feats[t];
      let i = n - 1; while (i >= 0 && Number.isNaN(p[i])) i--;
      if (i < 0) continue;
      const row = { price: p[i], ret_5: f.ret_5[i], ret_10: f.ret_10[i], ret_21: f.ret_21[i], ret_63: f.ret_63[i], ret_126: f.ret_126[i], trend: f.trend[i] };
      if (!(row.ret_21 <= -0.10)) continue;
      let nw = null;
      if (news) { const st = E.newsStats(news.items, new Set([t]), asOf); nw = st.n ? { n: st.n, avg: st.avg, z: zOf.has(t) ? zOf.get(t) : null } : null; }
      cands.push({ t, row, info, news: nw });
    }
    lists["pullbacks:1m"] = P.screen(cands, { window: "1m", minDrop: 0.10, limit: TOP }).shown.map((r) => r.t);
    return { date: dates[n - 1], universe: tickers.length, lists };
  }

  const api = { buildLists, LISTS, TOP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Picks = api;
})(typeof self !== "undefined" ? self : this);
