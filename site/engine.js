/* Scoring + backtest. A line-for-line port of scoring.py and backtest.py (pandas semantics:
   NaN propagates, rolling windows need every value, std uses ddof=1). Works in the browser
   and in Node (for the cross-check against the Python version). */
(function (root) {
  "use strict";

  const WEIGHTS = { mom_12_1: 0.35, mom_6_1: 0.20, trend: 0.20, low_vol: 0.15, near_high: 0.10 };
  const TRADING_DAYS = 252;

  /* Ranking horizons. "long" is the original model (12-1m and 6-1m momentum). The short ones keep
     the same trend / volatility / near-high parts but replace both momentum terms with the return
     over the last `days` trading days (weight 0.35 + 0.20 = 0.55), and rebalance at that cadence. */
  const HORIZONS = {
    long: { label: "Long-term", days: null, rebalance: "month", blurb: "12-1 and 6-1 month momentum" },
    "1m": { label: "1 month", days: 21, rebalance: "month", blurb: "last 1-month return" },
    "2w": { label: "2 weeks", days: 10, rebalance: "2week", blurb: "last 2-week return" },
    "1w": { label: "1 week", days: 5, rebalance: "week", blurb: "last 1-week return" },
  };
  const RET_WEIGHT = WEIGHTS.mom_12_1 + WEIGHTS.mom_6_1;

  const nan = (n) => new Float64Array(n).fill(NaN);

  function shift(a, k) {
    const o = nan(a.length);
    for (let i = k; i < a.length; i++) o[i] = a[i - k];
    return o;
  }

  function pctChange(a) {
    const o = nan(a.length);
    for (let i = 1; i < a.length; i++) o[i] = a[i] / a[i - 1] - 1;
    return o;
  }

  // Generic trailing window; `fn` gets (array, endIndex, window) and only runs when the
  // whole window is valid (pandas min_periods == window).
  function rolling(a, w, fn) {
    const o = nan(a.length);
    let bad = 0;
    for (let i = 0; i < a.length; i++) {
      if (Number.isNaN(a[i])) bad++;
      if (i >= w && Number.isNaN(a[i - w])) bad--;
      if (i >= w - 1 && bad === 0) o[i] = fn(a, i, w);
    }
    return o;
  }

  const mean = (a, i, w) => { let s = 0; for (let k = i - w + 1; k <= i; k++) s += a[k]; return s / w; };
  const max = (a, i, w) => { let m = -Infinity; for (let k = i - w + 1; k <= i; k++) if (a[k] > m) m = a[k]; return m; };
  const std = (a, i, w) => {
    const m = mean(a, i, w);
    let s = 0;
    for (let k = i - w + 1; k <= i; k++) s += (a[k] - m) * (a[k] - m);
    return Math.sqrt(s / (w - 1));
  };

  /* Single-pass versions of the rolling windows above (O(n) instead of O(n*w)), used for the ~500-stock
     universe. Same rule: a window only has a value when every entry in it is valid. */
  function rollMeanFast(a, w) {
    const n = a.length, o = nan(n);
    let sum = 0, bad = 0;
    for (let i = 0; i < n; i++) {
      const v = a[i];
      if (v !== v) bad++; else sum += v;
      if (i >= w) { const u = a[i - w]; if (u !== u) bad--; else sum -= u; }
      if (i >= w - 1 && bad === 0) o[i] = sum / w;
    }
    return o;
  }
  function rollMaxFast(a, w) {  // monotonic queue
    const n = a.length, o = nan(n), dq = new Int32Array(n);
    let head = 0, tail = 0, bad = 0;
    for (let i = 0; i < n; i++) {
      const v = a[i];
      if (v !== v) bad++;
      else { while (tail > head && a[dq[tail - 1]] <= v) tail--; dq[tail++] = i; }
      if (i >= w && a[i - w] !== a[i - w]) bad--;
      while (tail > head && dq[head] <= i - w) head++;
      if (i >= w - 1 && bad === 0) o[i] = a[dq[head]];
    }
    return o;
  }
  function rollStdFast(a, w) {  // sample std (ddof = 1) from running sums
    const n = a.length, o = nan(n);
    let sum = 0, sumsq = 0, bad = 0;
    for (let i = 0; i < n; i++) {
      const v = a[i];
      if (v !== v) bad++; else { sum += v; sumsq += v * v; }
      if (i >= w) { const u = a[i - w]; if (u !== u) bad--; else { sum -= u; sumsq -= u * u; } }
      if (i >= w - 1 && bad === 0) o[i] = Math.sqrt(Math.max(0, (sumsq - (sum * sum) / w) / (w - 1)));
    }
    return o;
  }

  /* Features for one price series, each value at t using only data up to t. */
  function featuresFor(p) {
    const n = p.length;
    const s21 = shift(p, 21), s126 = shift(p, 126), s252 = shift(p, 252);
    const sma50 = rollMeanFast(p, 50), sma200 = rollMeanFast(p, 200);
    const hi = rollMaxFast(p, 252);
    const vol = rollStdFast(pctChange(p), 63);
    const s5 = shift(p, 5), s10 = shift(p, 10);
    const f = { mom_12_1: nan(n), mom_6_1: nan(n), trend: nan(n), vol_63d: nan(n), drawdown_1y: nan(n),
      ret_5: nan(n), ret_10: nan(n), ret_21: nan(n) };
    for (let i = 0; i < n; i++) {
      f.mom_12_1[i] = s21[i] / s252[i] - 1;
      f.mom_6_1[i] = s21[i] / s126[i] - 1;
      f.ret_5[i] = p[i] / s5[i] - 1;
      f.ret_10[i] = p[i] / s10[i] - 1;
      f.ret_21[i] = p[i] / s21[i] - 1;
      if (!Number.isNaN(sma200[i]) && !Number.isNaN(p[i])) {
        f.trend[i] = (p[i] > sma200[i] ? 1 : 0) + (sma50[i] > sma200[i] ? 1 : 0);
      }
      f.vol_63d[i] = vol[i] * Math.sqrt(TRADING_DAYS);
      f.drawdown_1y[i] = p[i] / hi[i] - 1;
    }
    return f;
  }

  /* Cross-sectional z-score per date over the given columns, clipped to +-3.
     A lone valid value (or an all-equal day) is neutral 0, not missing. */
  function zScore(cols, n, idx) {
    const m = cols.length, z = cols.map(() => nan(n));
    const day = (i) => {
      let cnt = 0, sum = 0;
      for (let j = 0; j < m; j++) { const v = cols[j][i]; if (v === v) { cnt++; sum += v; } }
      if (cnt === 0) return;
      const mu = sum / cnt;
      let ss = 0;
      for (let j = 0; j < m; j++) { const v = cols[j][i]; if (v === v) ss += (v - mu) * (v - mu); }
      const sd = cnt > 1 ? Math.sqrt(ss / (cnt - 1)) : NaN;
      for (let j = 0; j < m; j++) {
        const v = cols[j][i];
        if (v !== v) continue;
        const q = sd > 0 ? (v - mu) / sd : 0;
        z[j][i] = q > 3 ? 3 : q < -3 ? -3 : q;
      }
    };
    if (idx) for (const i of idx) day(i); else for (let i = 0; i < n; i++) day(i);
    return z;
  }

  /* feats: array (one per ticker) of featuresFor() results. Returns one score series per ticker.
     A score is missing if any component is missing (NaN propagates, like the pandas sum). */
  function scores(feats, n, horizon = "long", idx = null) {
    const days = HORIZONS[horizon].days;
    const retKey = { 5: "ret_5", 10: "ret_10", 21: "ret_21" }[days];
    const zs = {
      mom_12_1: retKey ? null : zScore(feats.map((f) => f.mom_12_1), n, idx),
      mom_6_1: retKey ? null : zScore(feats.map((f) => f.mom_6_1), n, idx),
      ret: retKey ? zScore(feats.map((f) => f[retKey]), n, idx) : null,
      trend: zScore(feats.map((f) => f.trend), n, idx),
      low_vol: zScore(feats.map((f) => f.vol_63d), n, idx),
      near_high: zScore(feats.map((f) => f.drawdown_1y), n, idx),
    };
    return feats.map((_, j) => {
      const s = nan(n);
      const each = (i) => {
        const mom = zs.ret ? RET_WEIGHT * zs.ret[j][i]
          : WEIGHTS.mom_12_1 * zs.mom_12_1[j][i] + WEIGHTS.mom_6_1 * zs.mom_6_1[j][i];
        s[i] = mom
          + WEIGHTS.trend * zs.trend[j][i] - WEIGHTS.low_vol * zs.low_vol[j][i]
          + WEIGHTS.near_high * zs.near_high[j][i];
      };
      if (idx) for (const i of idx) each(i); else for (let i = 0; i < n; i++) each(i);
      return s;
    });
  }

  const TREND_LABEL = { 2: "Strong uptrend", 1: "Mixed trend", 0: "Downtrend" };

  /* Ranked snapshot on the most recent date with any score. */
  /* Last date on which at least one stock has every input of the score (the score is missing if any is). */
  function latestIndex(feats, n, horizon) {
    const retKey = { 5: "ret_5", 10: "ret_10", 21: "ret_21" }[HORIZONS[horizon].days];
    for (let i = n - 1; i >= 0; i--) {
      for (const f of feats) {
        if (f.trend[i] === f.trend[i] && f.vol_63d[i] === f.vol_63d[i] && f.drawdown_1y[i] === f.drawdown_1y[i]
          && (retKey ? f[retKey][i] === f[retKey][i] : f.mom_12_1[i] === f.mom_12_1[i] && f.mom_6_1[i] === f.mom_6_1[i])) return i;
      }
    }
    return -1;
  }

  function latestTable(tickers, prices, feats, n, horizon = "long") {
    const d = latestIndex(feats, n, horizon);
    if (d < 0) throw new Error("Not enough price history yet (need about 1 year per stock).");
    const sc = scores(feats, n, horizon, [d]);
    const rows = [];
    tickers.forEach((t, j) => {
      if (Number.isNaN(sc[j][d])) return;
      rows.push({
        ticker: t, price: prices[j][d], score: sc[j][d],
        mom_12_1: feats[j].mom_12_1[d], mom_6_1: feats[j].mom_6_1[d],
        ret_5: feats[j].ret_5[d], ret_10: feats[j].ret_10[d], ret_21: feats[j].ret_21[d],
        trend: feats[j].trend[d], trend_label: TREND_LABEL[feats[j].trend[d]],
        vol_63d: feats[j].vol_63d[d], drawdown_1y: feats[j].drawdown_1y[d],
      });
    });
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, k) => { r.rank = k + 1; });
    return { rows, asofIndex: d };
  }

  /* Python-style "{:+.0%}" / "{:.0%}". */
  function pct(v, digits = 0, plus = false) {
    const s = (v * 100).toFixed(digits) + "%";
    return plus && v >= 0 ? "+" + s : s;
  }

  function explain(r, horizon = "long") {
    const h = HORIZONS[horizon];
    const lead = h.days
      ? `Return over ${h.label.toLowerCase()} ${pct(r[{ 5: "ret_5", 10: "ret_10", 21: "ret_21" }[h.days]], 1, true)} `
        + `(1w ${pct(r.ret_5, 1, true)}, 2w ${pct(r.ret_10, 1, true)}, 1m ${pct(r.ret_21, 1, true)}); `
      : `12-1m momentum ${pct(r.mom_12_1, 0, true)}, 6-1m ${pct(r.mom_6_1, 0, true)}; `;
    return lead
      + `${r.trend_label.toLowerCase()}; volatility ${pct(r.vol_63d)}; `
      + `${pct(r.drawdown_1y)} from 1-year high`;
  }

  /* ---------- backtest ---------- */

  function weekKey(dateStr) {  // ISO week, Monday-Sunday
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
    const week = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
    return `${d.getUTCFullYear()}-${week}`;
  }

  /* Index of the last trading day of each month / ISO week; "2week" keeps every other week. */
  function rebalanceIdx(dates, cadence = "month") {
    const last = new Map();
    dates.forEach((d, i) => last.set(cadence === "month" ? d.slice(0, 7) : weekKey(d), i));
    const idx = [...last.values()].sort((a, b) => a - b);
    return cadence === "2week" ? idx.filter((_, k) => k % 2 === 0) : idx;
  }

  // target[i] is a weight vector (decided at date i) or null. Mirrors _simulate().
  function simulate(target, rets, costBps, lag) {
    const n = target.length, m = rets.length;
    const held = []; // weights held after each date's decision (forward-filled)
    let cur = new Float64Array(m);
    for (let i = 0; i < n; i++) { if (target[i]) cur = target[i]; held.push(cur); }
    const zero = new Float64Array(m);
    const pos = (i) => (i - (1 + lag) >= 0 ? held[i - (1 + lag)] : zero);

    const net = new Float64Array(n), turn = new Float64Array(n), live = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = pos(i), q = i === 0 ? zero : pos(i - 1);
      let t = 0, g = 0, a = 0;
      for (let j = 0; j < m; j++) { t += Math.abs(p[j] - q[j]); g += p[j] * rets[j][i]; a += Math.abs(p[j]); }
      turn[i] = t;
      net[i] = g - t * costBps / 1e4;
      live[i] = a > 0;
    }
    const start = live.indexOf(true);
    if (start < 0) throw new Error("No trades were generated; need more price history.");
    return { net: net.subarray(start), turnover: turn.subarray(start), start };
  }

  function perfStats(r) {
    let eq = 1, peak = 1, mdd = 0, sum = 0;
    for (const x of r) { eq *= 1 + x; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); sum += x; }
    const mu = sum / r.length;
    let ss = 0;
    for (const x of r) ss += (x - mu) * (x - mu);
    const years = r.length / TRADING_DAYS;
    const vol = Math.sqrt(ss / (r.length - 1)) * Math.sqrt(TRADING_DAYS);
    return {
      "Total return": eq - 1,
      "CAGR": years > 0 ? Math.pow(eq, 1 / years) - 1 : NaN,
      "Volatility": vol,
      "Sharpe": vol > 0 ? (mu * TRADING_DAYS) / vol : NaN,
      "Max drawdown": mdd,
    };
  }

  /* prices/feats: per-ticker arrays for the chosen universe; bench: {name: Float64Array}. */
  function runBacktest(dates, prices, feats, bench, topN, costBps, lag = 1, horizon = "long") {
    const n = dates.length, m = prices.length;
    const rets = prices.map((p) => pctChange(p).map((x) => (Number.isNaN(x) ? 0 : x)));
    const reb = rebalanceIdx(dates, HORIZONS[horizon].rebalance);
    const sc = scores(feats, n, horizon, reb);

    const tgtTop = new Array(n).fill(null), tgtAll = new Array(n).fill(null);
    for (const d of reb) {
      const valid = [];
      for (let j = 0; j < m; j++) if (!Number.isNaN(sc[j][d])) valid.push(j);
      if (valid.length < Math.max(topN, 2)) continue;
      const w = new Float64Array(m);
      [...valid].sort((a, b) => sc[b][d] - sc[a][d] || a - b).slice(0, topN).forEach((j) => { w[j] = 1 / topN; });
      tgtTop[d] = w;
      const a = new Float64Array(m);
      valid.forEach((j) => { a[j] = 1 / valid.length; });
      tgtAll[d] = a;
    }

    const strat = simulate(tgtTop, rets, costBps, lag);
    const ew = simulate(tgtAll, rets, costBps, lag);
    const start = strat.start, len = n - start;
    const series = {};
    series[`Top ${topN} by score`] = strat.net;
    series["Equal-weight universe"] = ew.net.subarray(start - ew.start);

    for (const [name, p] of Object.entries(bench)) {
      const filled = Float64Array.from(p);
      for (let i = 1; i < n; i++) if (Number.isNaN(filled[i])) filled[i] = filled[i - 1];
      const r = new Float64Array(len);
      for (let i = 1; i < len; i++) {
        const x = filled[start + i] / filled[start + i - 1] - 1;
        r[i] = Number.isNaN(x) ? 0 : x;
      }
      series[`${name} (buy & hold)`] = r;
    }

    const bdates = dates.slice(start);
    const years = [...new Set(bdates.map((d) => d.slice(0, 4)))];
    const out = { dates: bdates, equity: {}, metrics: {}, yearly: { years, values: {} } };
    for (const [name, r] of Object.entries(series)) {
      const eq = new Float64Array(len);
      let v = 1;
      for (let i = 0; i < len; i++) { v *= 1 + r[i]; eq[i] = v; }
      out.equity[name] = eq;
      out.metrics[name] = perfStats(r);
      const prod = {};
      for (let i = 0; i < len; i++) { const y = bdates[i].slice(0, 4); prod[y] = (prod[y] ?? 1) * (1 + r[i]); }
      out.yearly.values[name] = years.map((y) => prod[y] - 1);
    }
    const yrs = len / TRADING_DAYS;
    out.metrics[`Top ${topN} by score`]["Annual turnover"] = strat.turnover.reduce((a, b) => a + b, 0) / 2 / yrs;
    return out;
  }

  /* ---------- sectors & news ---------- */

  const NEWS_DAYS = 7, NEWS_HALF_LIFE_DAYS = 3;
  const SECTOR_NEWS_WEIGHT = 0.30, STOCK_NEWS_WEIGHT = 0.25;
  const SECTOR_SHRINK = 3, STOCK_SHRINK = 2;  // few headlines -> pull the tone toward neutral

  /* Recency-weighted mean tone of the last NEWS_DAYS of headlines that mention any ticker in `set`. */
  function newsStats(items, set, asOfMs) {
    let n = 0, sw = 0, sws = 0;
    const used = [];
    for (const it of items) {
      if (!it.tickers.some((t) => set.has(t))) continue;
      const age = Math.max(0, (asOfMs - Date.parse(it.time)) / 864e5);
      if (age > NEWS_DAYS) continue;
      const w = Math.pow(0.5, age / NEWS_HALF_LIFE_DAYS);
      n++; sw += w; sws += w * it.score;
      used.push(it);
    }
    return { n, avg: sw > 0 ? sws / sw : 0, items: used };
  }

  /* The headlines behind a tone number, most influential first. Impact = share of the total "tone signal"
     (recency weight x |score|); `lift` says whether it pushed the average tone up or down. Same window and
     weights as newsStats, so these are exactly the headlines used in the recommendation. */
  function rankedHeadlines(items, set, asOfMs) {
    const used = [];
    let total = 0;
    for (const it of items) {
      if (!it.tickers.some((t) => set.has(t))) continue;
      const age = Math.max(0, (asOfMs - Date.parse(it.time)) / 864e5);
      if (age > NEWS_DAYS) continue;
      const w = Math.pow(0.5, age / NEWS_HALF_LIFE_DAYS);
      used.push({ item: it, w, signal: w * Math.abs(it.score), lift: it.score > 0.15 ? 1 : it.score < -0.15 ? -1 : 0 });
      total += w * Math.abs(it.score);
    }
    used.forEach((u) => { u.impact = total > 0 ? u.signal / total : 0; });
    used.sort((a, b) => b.signal - a.signal || Date.parse(b.item.time) - Date.parse(a.item.time));
    return { used, pos: used.filter((u) => u.lift > 0).length, neg: used.filter((u) => u.lift < 0).length, neutral: used.filter((u) => u.lift === 0).length };
  }

  function zList(v) {
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1));
    return v.map((x) => (sd > 0 ? (x - m) / sd : 0));
  }

  /* sd: {dates, sectors: {name: {etf, stocks}}, prices: {ticker: Float64Array}}; news: {generated, items}.
     Sector score = 70% price score (chosen horizon) + 30% z-scored news tone; stock = 75% / 25%. */
  function sectorAnalysis(sd, news, horizon = "long") {
    const n = sd.dates.length;
    const names = Object.keys(sd.sectors);
    const allItems = news && Array.isArray(news.items) ? news.items : [];
    const gen = news && news.generated ? Date.parse(news.generated.replace(" UTC", "Z").replace(" ", "T")) : NaN;
    const asOfMs = Number.isNaN(gen) ? Date.now() : gen;
    const hasNews = allItems.length > 0;

    const table = (tickers) => {
      const P = tickers.map((t) => sd.prices[t]);
      const F = P.map(featuresFor);
      const res = latestTable(tickers, P, F, n, horizon);
      return new Map(res.rows.map((r) => [r.ticker, r]));
    };
    const etfRows = table(names.map((k) => sd.sectors[k].etf));
    const stockList = [...new Set(names.flatMap((k) => sd.sectors[k].stocks))];
    const stockRows = table(stockList);

    // news per stock, z-scored across all stocks
    const stockNews = new Map(stockList.map((t) => [t, newsStats(allItems, new Set([t]), asOfMs)]));
    const stockZ = zList(stockList.map((t) => { const s = stockNews.get(t); return s.avg * s.n / (s.n + STOCK_SHRINK); }));
    const stockZMap = new Map(stockList.map((t, i) => [t, stockZ[i]]));

    // news per sector (ETF + its stocks pooled), z-scored across sectors
    const secNews = names.map((k) => newsStats(allItems, new Set([sd.sectors[k].etf, ...sd.sectors[k].stocks]), asOfMs));
    const secZ = zList(secNews.map((s) => s.avg * s.n / (s.n + SECTOR_SHRINK)));

    const sectors = [];
    names.forEach((name, i) => {
      const spec = sd.sectors[name], etf = etfRows.get(spec.etf);
      if (!etf) return;
      const nz = hasNews ? secZ[i] : 0;
      const stocks = spec.stocks.filter((t) => stockRows.has(t)).map((t) => {
        const r = stockRows.get(t), nw = stockNews.get(t);
        const z = hasNews ? stockZMap.get(t) : 0;
        const latest = nw.items.slice().sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0] || null;
        return { ...r, sector: name, priceScore: r.score, newsAvg: nw.avg, newsN: nw.n, newsZ: z,
          final: (hasNews ? 1 - STOCK_NEWS_WEIGHT : 1) * r.score + (hasNews ? STOCK_NEWS_WEIGHT : 0) * z, headline: latest };
      }).sort((a, b) => b.final - a.final);
      sectors.push({
        name, etf: spec.etf, etfRow: etf, priceScore: etf.score, newsAvg: secNews[i].avg, newsN: secNews[i].n, newsZ: nz,
        final: (hasNews ? 1 - SECTOR_NEWS_WEIGHT : 1) * etf.score + (hasNews ? SECTOR_NEWS_WEIGHT : 0) * nz,
        headlines: secNews[i].items.slice().sort((a, b) => Date.parse(b.time) - Date.parse(a.time)), stocks,
      });
    });
    sectors.sort((a, b) => b.final - a.final);
    sectors.forEach((s, k) => { s.rank = k + 1; });
    return { sectors, hasNews, newsGenerated: news ? news.generated : null, asOf: sd.dates[sd.dates.length - 1] };
  }

  /* The Sectors view works on the last ~year of the same price file. data: parsed data.json; series(t) gives a
     ticker's Float64Array of prices (full length). Sector ETFs and members come from data.groups. */
  function deriveSectorData(data, series, days = 320) {
    const n = data.dates.length, from = Math.max(0, n - days);
    const sectors = {}, prices = {};
    for (const g of data.groups) {
      if (!g.etf) continue;
      sectors[g.name] = { etf: g.etf, stocks: g.tickers.filter((t) => series(t)) };
      for (const t of [g.etf, ...sectors[g.name].stocks]) if (!prices[t]) prices[t] = series(t).subarray(from);
    }
    return { dates: data.dates.slice(from), sectors, prices };
  }

  const api = { deriveSectorData, TREND_LABEL, sectorAnalysis, newsStats, rankedHeadlines, NEWS_DAYS, WEIGHTS, HORIZONS, rebalanceIdx, scores, featuresFor, latestTable, explain, pct, runBacktest, rolling, mean };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== "undefined" ? self : this);
