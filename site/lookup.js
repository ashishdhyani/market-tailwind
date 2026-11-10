/* Lookup tab logic: turns the JSON written by lookup.py (any stock or ETF Yahoo knows, not just the app's list) into a
   report. Pure (no DOM, no network), so it runs in Node tests. The result file comes from a public branch, so it is
   treated as untrusted: sanitize() rebuilds it from whitelisted fields and types, and every string is escaped on output.
   It describes the stock and lists evidence for and against. It never says buy or sell. */
(function (root) {
  "use strict";
  const E = typeof require !== "undefined" ? require("./engine.js") : root.Engine;
  const F = typeof require !== "undefined" ? require("./fundamentals.js") : root.Fundamentals;
  const O = typeof require !== "undefined" ? require("./lookup_options.js") : root.LookupOptions;

  const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
  const FRESH_HOURS = 6;
  const MIXED = new Set(["ps", "pb", "ev_ebitda", "fcf"]);   // info fields that divide price by company money
  const WINDOWS = [[5, "1 week"], [10, "2 weeks"], [21, "1 month"], [63, "3 months"], [126, "6 months"], [252, "1 year"]];

  /* "sofi", " $SOFI ", "brk.b" -> "SOFI", "SOFI", "BRK-B" (Yahoo writes share classes with a hyphen). null if not a symbol. */
  function cleanSymbol(s) {
    let u = String(s == null ? "" : s).trim().toUpperCase().replace(/^\$/, "");
    if (/^[A-Z]{1,5}\.[AB]$/.test(u)) u = u.replace(".", "-");
    return SYMBOL_RE.test(u) ? u : null;
  }

  /* ---------- sanitising the downloaded file ---------- */
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
  const nm = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const st = (v, max = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || null : null);
  const dt = (v) => (isDate(v) ? v : null);
  const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const url = (v) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v.slice(0, 500) : null);
  const pick = (o, spec) => { const out = {}; for (const [k, f] of Object.entries(spec)) out[k] = f(obj(o)[k]); return out; };
  const nums = (...keys) => Object.fromEntries(keys.map((k) => [k, nm]));

  const INFO_TEXT = new Set(["name", "type", "sector", "industry", "currency", "category", "family"]);
  const INFO_DATE = new Set(["next_earnings", "ex_div"]);
  const STMT_KEYS = ["revenue", "gross_profit", "operating_income", "net_income", "ebitda", "eps", "operating_cf", "capex", "fcf", "cash", "debt", "equity", "assets"];

  function sanitize(raw) {
    if (!raw || typeof raw !== "object" || raw.version !== 1) return { error: "The result file is not in a format this page understands." };
    const symbol = cleanSymbol(raw.symbol);
    if (!symbol) return { error: "The result file has no valid symbol." };
    const base = { symbol, fetched: st(raw.fetched, 30), fetched_ts: nm(raw.fetched_ts) || 0, errors: {} };
    for (const [k, v] of Object.entries(obj(raw.errors)).slice(0, 20)) base.errors[st(k, 40) || "?"] = st(v, 160) || "";
    if (!raw.found) return { report: { ...base, found: false, error: st(raw.error, 240) || "Yahoo Finance has no data for this symbol." } };

    const pr = obj(raw.prices), dates = [], close = [], volume = [];
    const D = arr(pr.dates, 4000), C = arr(pr.close, 4000), V = arr(pr.volume, 4000);
    for (let i = 0; i < D.length; i++) {
      if (!isDate(D[i]) || !(nm(C[i]) > 0) || (dates.length && D[i] <= dates[dates.length - 1])) continue;   // ascending, valid prices only
      dates.push(D[i]); close.push(C[i]); volume.push(nm(V[i]) >= 0 ? V[i] : null);
    }
    if (dates.length < 2) return { report: { ...base, found: false, error: "Not enough price history came back for this symbol." } };

    const info = {};
    for (const [k, v] of Object.entries(obj(raw.info)).slice(0, 80)) {
      if (!/^[a-z0-9_]{1,24}$/.test(k)) continue;
      const val = INFO_TEXT.has(k) ? st(v, 120) : INFO_DATE.has(k) ? dt(v) : nm(v);
      if (val !== null) info[k] = val;
    }
    const extra = {};
    for (const [k, v] of Object.entries(obj(raw.extra)).slice(0, 80)) if (/^[a-z0-9_]{1,24}$/.test(k) && nm(v) !== null) extra[k] = v;
    const p = obj(raw.profile);
    const profile = { ...pick(p, { name: (v) => st(v, 120), exchange: st, currency: (v) => st(v, 8), financial_currency: (v) => st(v, 8), type: (v) => st(v, 20), sector: st, industry: st, country: st,
      website: (v) => (url(v) ? st(v, 120) : null), employees: nm, summary: (v) => st(v, 1500), category: st, family: st }) };
    if (!profile.name) profile.name = symbol;
    const pairs = (v, max) => arr(v, max).filter((x) => Array.isArray(x) && isDate(x[0]) && nm(x[1]) !== null).map((x) => [x[0], x[1]]);
    const stmts = (v) => arr(v, 10).map((r) => ({ period: dt(obj(r).period), ...Object.fromEntries(STMT_KEYS.map((k) => [k, nm(obj(r)[k])])) })).filter((r) => r.period);
    const an = obj(raw.analysts);
    const est = (v) => arr(v, 8).map((r) => ({ period: st(obj(r).period, 8), ...pick(r, nums("avg", "low", "high", "growth", "numberOfAnalysts")) }));
    return { report: {
      ...base, found: true, prices: { dates, close, volume }, profile, info, extra,
      dividends: pairs(raw.dividends, 60), splits: pairs(raw.splits, 20),
      financials: { annual: stmts(obj(raw.financials).annual), quarterly: stmts(obj(raw.financials).quarterly) },
      analysts: {
        trend: arr(an.trend, 6).map((r) => ({ period: st(obj(r).period, 8), ...pick(r, nums("strongBuy", "buy", "hold", "sell", "strongSell")) })),
        targets: pick(an.targets, nums("current", "high", "low", "mean", "median")),
        changes: arr(an.changes, 15).map((r) => ({ date: dt(obj(r).date), firm: st(obj(r).firm, 60), to: st(obj(r).to, 30), from: st(obj(r).from, 30), action: st(obj(r).action, 20), target: nm(obj(r).target) })),
        estimates: { eps: est(obj(an.estimates).eps), revenue: est(obj(an.estimates).revenue) },
      },
      earnings: { history: arr(obj(raw.earnings).history, 10).map((r) => ({ date: dt(obj(r).date), ...pick(r, nums("estimate", "actual", "surprise_pct")) })) },
      options: O.sanitize(raw.options),
      holders: { top: arr(obj(raw.holders).top, 12).map((r) => ({ holder: st(obj(r).holder, 70), ...pick(r, nums("pct", "shares", "value", "change")) })) },
      insiders: arr(raw.insiders, 15).map((r) => ({ date: dt(obj(r).date), insider: st(obj(r).insider, 50), position: st(obj(r).position, 40), text: st(obj(r).text, 120), shares: nm(obj(r).shares), value: nm(obj(r).value) })),
      news: arr(raw.news, 20).filter((n) => st(obj(n).title)).map((n) => ({ title: st(n.title, 200), url: url(n.url), time: typeof n.time === "string" && !Number.isNaN(Date.parse(n.time)) ? n.time : null,
        summary: st(n.summary, 260), score: nm(n.score) || 0 })),
    } };
  }

  const ageHours = (rep, nowMs = Date.now()) => (rep.fetched_ts ? (nowMs / 1000 - rep.fetched_ts) / 3600 : Infinity);
  const isFresh = (rep, nowMs) => ageHours(rep, nowMs) < FRESH_HOURS;

  /* ---------- price analysis ---------- */
  const fin = (v) => (Number.isFinite(v) ? v : null);

  function priceStats(prices) {
    const p = Float64Array.from(prices.close), n = p.length, i = n - 1, f = E.featuresFor(p);
    const win = (k) => p.subarray(Math.max(0, n - k));
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const year = win(252);
    return {
      n, asOf: prices.dates[i], price: p[i], prev: n > 1 ? p[i - 1] : null,
      ret: Object.fromEntries(WINDOWS.map(([k]) => [k, n > k ? fin(p[i] / p[i - k] - 1) : null])),
      mom_12_1: fin(f.mom_12_1[i]), mom_6_1: fin(f.mom_6_1[i]), vol_63d: fin(f.vol_63d[i]), drawdown_1y: fin(f.drawdown_1y[i]), trend: Number.isNaN(f.trend[i]) ? null : f.trend[i],
      sma50: n >= 50 ? mean(win(50)) : null, sma200: n >= 200 ? mean(win(200)) : null,
      hi52: Math.max(...year), lo52: Math.min(...year), fullYear: n >= 253,
      years: (Date.parse(prices.dates[i]) - Date.parse(prices.dates[0])) / (365.25 * 864e5),
    };
  }

  /* spy: { dates, close } (any NaN allowed). Returns, over the same windows, the stock minus SPY (in return points), plus beta/correlation over the last year. */
  function relative(prices, spy) {
    if (!spy || !spy.dates || !spy.close) return null;
    const m = new Map(spy.dates.map((d, i) => [d, spy.close[i]]));
    let last = NaN;
    const a = prices.dates.map((d) => { const v = m.get(d); if (v > 0) last = v; return last; });
    const p = prices.close, n = p.length, i = n - 1;
    if (!(a[i] > 0)) return null;
    const out = { spy: {}, diff: {} };
    for (const [k] of WINDOWS) {
      const s = n > k && a[i - k] > 0 ? a[i] / a[i - k] - 1 : null, x = n > k ? p[i] / p[i - k] - 1 : null;
      out.spy[k] = s; out.diff[k] = s !== null && x !== null ? x - s : null;
    }
    const xs = [], ys = [];
    for (let j = Math.max(1, n - 252); j < n; j++) if (a[j] > 0 && a[j - 1] > 0) { xs.push(p[j] / p[j - 1] - 1); ys.push(a[j] / a[j - 1] - 1); }
    if (xs.length >= 60) {
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let sxy = 0, sxx = 0, syy = 0;
      for (let j = 0; j < xs.length; j++) { sxy += (xs[j] - mx) * (ys[j] - my); sxx += (xs[j] - mx) ** 2; syy += (ys[j] - my) ** 2; }
      if (sxx > 0 && syy > 0) { out.beta = sxy / syy; out.corr = sxy / Math.sqrt(sxx * syy); out.days = xs.length; }
    }
    return out;
  }

  /* Where the stock sits among the app's own universe (rows from Engine.latestTable). "share below" = fraction of the universe it beats. */
  function percentiles(stats, rows) {
    if (!rows || rows.length < 20) return null;
    const out = { of: rows.length };
    const rank = (key, v, higherBetter) => {
      if (v === null || v === undefined) return null;
      const ok = rows.filter((r) => Number.isFinite(r[key]));
      if (ok.length < 20) return null;
      const beaten = ok.filter((r) => (higherBetter ? r[key] < v : r[key] > v)).length;
      return beaten / ok.length;
    };
    out.ret_126 = rank("ret_126", stats.ret[126], true);
    out.ret_63 = rank("ret_63", stats.ret[63], true);
    out.ret_21 = rank("ret_21", stats.ret[21], true);
    out.mom_12_1 = rank("mom_12_1", stats.mom_12_1, true);
    out.calm = rank("vol_63d", stats.vol_63d, false);
    out.near_high = rank("drawdown_1y", stats.drawdown_1y, true);
    return out;
  }

  /* ---------- statements ---------- */
  const ratio = (a, b) => (a !== null && b !== null && b !== 0 ? a / b : null);
  const growth = (cur, prev) => (cur !== null && prev !== null && prev > 0 ? cur / prev - 1 : null);

  /* rows newest first. Annual growth compares with the next row; quarterly growth with the same quarter a year earlier (4 rows on). */
  function statementRows(list, lag) {
    return list.map((r, i) => {
      const prev = list[i + lag];
      return { ...r, rev_growth: prev ? growth(r.revenue, prev.revenue) : null, gross_margin: ratio(r.gross_profit, r.revenue), op_margin: ratio(r.operating_income, r.revenue), net_margin: ratio(r.net_income, r.revenue),
        net_cash: r.cash !== null && r.debt !== null ? r.cash - r.debt : null };
    });
  }

  function trends(fin_) {
    const annual = statementRows(fin_.annual, 1), quarterly = statementRows(fin_.quarterly, 4);
    const g = annual.map((r) => r.rev_growth).filter((v) => v !== null);
    const up = g.length >= 2 ? g.slice(0, Math.min(3, g.length)).every((v) => v > 0) : null;
    return { annual, quarterly, revUpYears: g.length ? g.slice(0, 3).length : 0, revGrowingAll: up, latestGrowth: g.length ? g[0] : null,
      fcfNow: annual[0] ? annual[0].fcf : null, fcfPositiveYears: annual.filter((r) => r.fcf !== null && r.fcf > 0).length, fcfYears: annual.filter((r) => r.fcf !== null).length };
  }

  /* ---------- the rest of the report ---------- */
  function analystView(rep, price) {
    const t = rep.analysts.trend[0], tg = rep.analysts.targets, out = { trend: t || null, upside: null, count: rep.info.analysts || null, buyShare: null };
    const mean = tg.mean ?? rep.info.target ?? null;
    if (mean && price > 0) out.upside = mean / price - 1;
    if (t) {
      const total = ["strongBuy", "buy", "hold", "sell", "strongSell"].reduce((s, k) => s + (t[k] || 0), 0);
      if (total > 0) out.buyShare = ((t.strongBuy || 0) + (t.buy || 0)) / total;
      out.total = total;
    }
    return out;
  }

  function earningsView(rep) {
    const h = rep.earnings.history.filter((r) => r.actual !== null && r.estimate !== null).slice(0, 8);
    const last4 = h.slice(0, 4), beats = last4.filter((r) => r.actual > r.estimate).length;
    return { rows: rep.earnings.history, last4: last4.length, beats };
  }

  function insiderView(rep) {
    let buys = 0, sells = 0, buyValue = 0, sellValue = 0;
    for (const t of rep.insiders) {
      const text = t.text || "";
      if (/purchase|bought/i.test(text)) { buys++; buyValue += t.value || 0; }
      else if (/\bsale\b|sold/i.test(text)) { sells++; sellValue += t.value || 0; }
    }
    return { buys, sells, buyValue, sellValue };
  }

  function dividendView(rep, price, asOf) {
    const d = rep.dividends;
    if (!d.length) return null;
    const end = Date.parse(asOf + "T00:00:00Z"), yr = 365 * 864e5;
    const within = (lo, hi) => d.filter(([dd]) => { const t = Date.parse(dd + "T00:00:00Z"); return t > end - hi && t <= end - lo; });
    const ttm = within(0, yr).reduce((s, [, v]) => s + v, 0), prior = within(yr, 2 * yr).reduce((s, [, v]) => s + v, 0);
    return { ttm, perYear: within(0, yr).length, yield: price > 0 && ttm > 0 ? ttm / price : null, change: prior > 0 && ttm > 0 ? ttm / prior - 1 : null, last: d.slice(-8).reverse() };
  }

  function newsView(rep) {
    const items = rep.news, n = items.length;
    if (!n) return { n: 0 };
    const avg = items.reduce((s, x) => s + x.score, 0) / n;
    return { n, avg, pos: items.filter((x) => x.score > 0.15).length, neg: items.filter((x) => x.score < -0.15).length, word: avg > 0.2 ? "positive" : avg < -0.1 ? "negative" : "neutral" };
  }

  /* ---------- evidence for and against (facts, not instructions) ---------- */
  const P = (v, d = 0) => E.pct(v, d);
  const SP = (v, d = 0) => E.pct(v, d, true);

  function checks(rep, A, nowMs) {
    const good = [], bad = [], notes = [], info = rep.info, etf = info.type === "ETF" || rep.profile.type === "ETF", s = A.stats;
    // price behaviour
    if (s.trend === 2) good.push("Price is above its 200-day average and the 50-day average is above the 200-day: an uptrend");
    else if (s.trend === 0) bad.push("Price is below its 200-day average and the 50-day is below the 200-day: a downtrend");
    if (A.rel && A.rel.diff[126] !== null) {
      if (A.rel.diff[126] > 0.1) good.push(`Beat SPY (the S&P 500) by ${P(A.rel.diff[126])} points over 6 months`);
      else if (A.rel.diff[126] < -0.1) bad.push(`Lagged SPY (the S&P 500) by ${P(-A.rel.diff[126])} points over 6 months`);
    }
    if (s.drawdown_1y !== null && s.drawdown_1y < -0.4) bad.push(`${P(-s.drawdown_1y)} below its 1-year high`);
    if (s.vol_63d !== null && s.vol_63d > 0.6) bad.push(`Very volatile: the price swings about ${P(s.vol_63d)} a year (the S&P 500 is typically 15 to 20%)`);
    if (!s.fullYear) notes.push(`Only ${s.n} trading days of history, so 1-year measures (momentum, high/low, trend) are incomplete. Recently listed companies are often more volatile.`);
    const avgDollar = rep.extra.avg_volume && s.price ? rep.extra.avg_volume * s.price : null;
    if (avgDollar !== null && avgDollar < 1e6) bad.push(`Thinly traded: about ${F.money(avgDollar, "USD")} changes hands a day, so prices can jump and orders may fill badly`);

    if (!etf) {
      const loss = F.lossInfo(info);
      if (loss) bad.push(loss.text);
      const T = A.trends;
      if (T.latestGrowth !== null) {
        if (T.revGrowingAll && T.revUpYears >= 3) good.push(`Sales grew each of the last ${T.revUpYears} years (latest ${SP(T.latestGrowth)})`);
        else if (T.latestGrowth < 0) bad.push(`Sales fell ${P(-T.latestGrowth)} in the latest year`);
      }
      if (T.fcfYears >= 2 && T.fcfPositiveYears === T.fcfYears) good.push(`Free cash flow was positive in each of the last ${T.fcfYears} years`);
      else if (T.fcfNow !== null && T.fcfNow < 0) bad.push("Free cash flow is negative in the latest year");
      if (/financial/i.test(info.sector || "") && T.fcfNow !== null) notes.push("For banks and lenders, 'free cash flow' includes loan flows and is not a useful quality measure; use earnings and capital ratios instead.");
      const e = A.earnings;
      if (e.last4 >= 3 && e.beats >= 3) good.push(`Beat analysts' earnings estimates in ${e.beats} of the last ${e.last4} quarters`);
      else if (e.last4 >= 3 && e.beats <= 1) bad.push(`Beat analysts' earnings estimates in only ${e.beats} of the last ${e.last4} quarters`);
      const a = A.analysts;
      if (a.upside !== null && (a.count || 0) >= 5) {
        if (a.upside >= 0.15) good.push(`Analysts' average price target is ${P(a.upside)} above the price (${a.count} analysts)`);
        else if (a.upside <= -0.05) bad.push(`The price is ${P(-a.upside)} above analysts' average target (${a.count} analysts)`);
      }
      if (rep.extra.short_pct_float > 0.1) bad.push(`${P(rep.extra.short_pct_float)} of the tradable shares are sold short: many investors are betting against it`);
      if (A.insiders.buys >= 2) good.push(`Insiders bought on the open market ${A.insiders.buys} times recently (${F.money(A.insiders.buyValue, "USD")})`);
      const ev = A.events;
      if (ev.earnings && ev.earnings.days <= 14) bad.push(`Earnings ${ev.earnings.text.replace(/^Earnings /, "")}: results often move a stock sharply either way`);
      if (A.currencyMismatch) notes.push(`This company reports in ${rep.profile.financial_currency} but its shares trade in ${rep.profile.currency}. Price-based ratios (price/sales, price/book, EV/EBITDA, free-cash-flow yield) mix the two currencies, so they are left out here; the statements below are in ${rep.profile.financial_currency}.`);
      const fe = A.fundamentals;
      if (fe) {
        for (const t of fe.strengths.slice(0, 3)) good.push(t);
        for (const t of fe.cautions.slice(0, 3)) bad.push(t);
      }
    } else {
      const ex = info.expense;
      if (ex != null) { if (ex <= 0.002) good.push(`Low cost: ${(ex * 100).toFixed(2)}% a year`); else if (ex >= 0.0075) bad.push(`Costly for a fund: ${(ex * 100).toFixed(2)}% a year`); }
      const aum = info.aum ?? rep.extra.net_assets;
      if (aum != null && aum < 5e7) bad.push(`Small fund (${F.money(aum, "USD")} of assets): small funds are more likely to be closed`);
      else if (aum != null && aum >= 1e9) good.push(`Large fund (${F.money(aum, "USD")} of assets)`);
      notes.push("This is a fund, so there are no company earnings. Look at what it holds and how it is built before judging it by past returns.");
    }
    const nv = A.news;
    if (nv.n >= 3) { if (nv.avg > 0.2) good.push(`Recent news tone is positive (${nv.pos} of ${nv.n} headlines)`); else if (nv.avg < -0.1) bad.push(`Recent news tone is negative (${nv.neg} of ${nv.n} headlines)`); }
    if (ageDaysSince(s.asOf, nowMs) > 7) notes.push(`The latest price is from ${s.asOf}, so the market may be closed, the stock suspended, or the data stale.`);
    return { good, bad, notes };
  }

  const ageDaysSince = (iso, nowMs) => Math.floor((nowMs - Date.parse(iso + "T00:00:00Z")) / 864e5);

  /* ctx: { spy, universe (rows), inApp ({rank, of, group} | null), now } */
  function analyze(rep, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const stats = priceStats(rep.prices);
    // A foreign company listed in another currency (an ADR): ratios that divide a price in one currency by money in the other are nonsense.
    const mismatch = !!(rep.profile.financial_currency && rep.profile.currency && rep.profile.financial_currency !== rep.profile.currency);
    const evalInfo = mismatch ? Object.fromEntries(Object.entries(rep.info).filter(([k]) => !MIXED.has(k))) : rep.info;
    const A = {currencyMismatch: mismatch,  stats, rel: relative(rep.prices, ctx.spy), pct: percentiles(stats, ctx.universe), trends: trends(rep.financials), analysts: analystView(rep, stats.price), earnings: earningsView(rep),
      insiders: insiderView(rep), dividends: dividendView(rep, stats.price, stats.asOf), news: newsView(rep), events: F.events(rep.info, now), inApp: ctx.inApp || null,
      fundamentals: rep.info.type === "ETF" ? null : F.evaluate(evalInfo, stats.price) };
    const closeOn = new Map(rep.prices.dates.map((d, i) => [d, rep.prices.close[i]]));
    A.options = O.analyze(rep.options, { spotOn: (d) => closeOn.get(d) || null, spot: stats.price, earnings: rep.info.next_earnings || null, realizedVol: stats.vol_63d, isEtf: rep.info.type === "ETF" || rep.profile.type === "ETF" });
    A.checks = checks(rep, A, now);
    A.ev = F.evaluate(evalInfo, stats.price);
    return A;
  }

  const api = { SYMBOL_RE, FRESH_HOURS, WINDOWS, cleanSymbol, sanitize, ageHours, isFresh, priceStats, relative, percentiles, statementRows, trends, analystView, earningsView, insiderView, dividendView, newsView, checks, analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Lookup = api;
})(typeof self !== "undefined" ? self : this);
