/* Scoreboard: how did the lists the app recorded in advance actually do? Pure maths, no DOM.

   For each recorded snapshot the basket is equal-weighted and "bought" at the NEXT trading day's close after the
   snapshot date (the same one-day delay the backtest uses), then measured after 6 months (126 trading days),
   3 months (63) and 1 month (21), against the benchmark over the same days. Returns are before costs and taxes. Nothing is
   backfilled, so this is out-of-sample evidence, but early on it is a tiny sample and consecutive daily snapshots
   overlap heavily, so the number of independent windows is reported next to every average. */
(function (root) {
  "use strict";

  // Longest first. Each needs that many trading days after entry before it has a result.
  const HORIZONS = [{ days: 126, label: "6 months" }, { days: 63, label: "3 months" }, { days: 21, label: "1 month" }];
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  function sd(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }

  /* Equal-weight return of `tickers` between two date indices; picks without a price at both ends are skipped. */
  function basketReturn(tickers, series, from, to) {
    const rs = [];
    for (const t of tickers) {
      const p = series(t);
      if (!p) continue;
      const a = p[from], b = p[to];
      if (a > 0 && b > 0) rs.push(b / a - 1);
    }
    return rs.length ? { value: mean(rs), used: rs.length } : null;
  }

  /* log: {snapshots:[{date, lists:{key:[tickers]}}]}; series(t) -> Float64Array aligned with `dates`; labels: {key: text}.
     Returns { snapshots, firstDate, lastDate, lists: {key: {label, rows, stats}} }. */
  function evaluate({ log, series, dates, bench, labels = {}, horizons = HORIZONS }) {
    const snaps = log && Array.isArray(log.snapshots) ? log.snapshots : [];
    const n = dates.length, index = new Map(dates.map((d, i) => [d, i]));
    const benchSeries = () => bench;
    const lists = {};
    for (const s of snaps) {
      const di = index.get(s.date);
      if (di === undefined) continue;                 // date no longer in the price file: skip rather than guess
      const entry = di + 1;                           // bought at the next trading day's close
      for (const [key, tickers] of Object.entries(s.lists || {})) {
        if (!tickers.length) continue;
        const L = (lists[key] ||= { key, label: labels[key] || key, rows: [], stats: {} });
        const row = { date: s.date, picks: tickers, byH: {}, sinceEntry: null, pending: entry > n - 1 };
        if (entry <= n - 1) {
          if (n - 1 > entry) {
            const b = basketReturn(tickers, series, entry, n - 1), m = basketReturn(["__bench"], () => bench, entry, n - 1);
            if (b && m) row.sinceEntry = { basket: b.value, bench: m.value, days: n - 1 - entry };
          }
          for (const h of horizons) {
            const exit = entry + h.days;
            if (exit > n - 1) { row.byH[h.days] = null; continue; }
            const b = basketReturn(tickers, series, entry, exit), m = basketReturn(["__bench"], () => bench, entry, exit);
            row.byH[h.days] = b && m ? { basket: b.value, bench: m.value, excess: b.value - m.value } : null;
          }
        }
        L.rows.push(row);
      }
    }
    for (const L of Object.values(lists)) {
      for (const h of horizons) {
        const done = L.rows.filter((r) => r.byH[h.days]);
        if (!done.length) { L.stats[h.days] = { n: 0 }; continue; }
        const ex = done.map((r) => r.byH[h.days].excess);
        const first = dates.indexOf(done[0].date), last = dates.indexOf(done[done.length - 1].date);
        L.stats[h.days] = {
          n: done.length, basket: mean(done.map((r) => r.byH[h.days].basket)), bench: mean(done.map((r) => r.byH[h.days].bench)),
          excess: mean(ex), hit: ex.filter((x) => x > 0).length / ex.length,
          se: done.length > 1 ? sd(ex) / Math.sqrt(done.length) : null,
          windows: Math.max(1, Math.floor((last - first) / h.days) + 1),      // roughly how many non-overlapping periods the snapshots span
        };
      }
    }
    return { snapshots: snaps.length, firstDate: snaps[0] && snaps[0].date, lastDate: snaps.length ? snaps[snaps.length - 1].date : null, lists };
  }

  const api = { evaluate, basketReturn, HORIZONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Scoreboard = api;
})(typeof self !== "undefined" ? self : this);
