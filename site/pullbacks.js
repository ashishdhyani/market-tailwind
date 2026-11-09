/* "Pullbacks to research": stocks that fell recently but still show supporting signs. Pure logic, no DOM.

   This is a screen, the same for everyone, not advice. A stock can fall because the market has spotted a real
   problem, and short-term moves often continue instead of reversing, so every result is a starting point for
   research. The supporting signs use only data the app really has: headline tone, profitability, analyst
   targets and ratings, expected earnings (forward vs trailing P/E), sales growth, and the 6-month trend.
   None of this can be tested historically (we only have today's analyst and fundamentals data), so the app
   does not claim it "works". */
(function (root) {
  "use strict";
  const F = typeof require !== "undefined" ? require("./fundamentals.js") : root.Fundamentals;

  const WINDOWS = {
    "1w": { label: "1 week", key: "ret_5" },
    "2w": { label: "2 weeks", key: "ret_10" },
    "1m": { label: "1 month", key: "ret_21" },
    "3m": { label: "3 months", key: "ret_63" },
  };
  // A fall this deep inside the window is itself a warning: analyst targets and ratings lag the price, so the
  // "upside" looks big simply because the price dropped, and sharp falls often mean news the data has not absorbed.
  const SHARP = { "1w": 0.15, "2w": 0.20, "1m": 0.25, "3m": 0.35 };
  const pc = (v, d = 0) => (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%";

  /* c: { t, row: {ret_*, trend, ...}, info (fundamentals entry or null), news: {n, z, avg} | null }
     Returns the evidence for and against, as short sentences. Missing data produces neither. */
  function assess(c) {
    const supports = [], cautions = [], info = c.info || {};
    const add = (list, key, text) => list.push({ key, text });

    // 1. News: has the tone turned against it? Too few headlines -> no opinion.
    const nw = c.news;
    if (nw && nw.n >= 3) {
      const good = nw.z != null ? nw.z >= 0 : nw.avg >= 0.3;
      const bad = nw.z != null ? nw.z <= -0.5 : nw.avg <= -0.1;
      if (good) add(supports, "news", `News tone is ${nw.z != null ? "about average or better than most" : "positive"} (${nw.n} recent headlines)`);
      else if (bad) add(cautions, "news", `News tone is weaker than most (${nw.n} recent headlines)`);
    }

    // 2. Profitability
    const loss = F.lossInfo(info);
    if (loss) add(cautions, "loss", loss.text);
    else if (info.roe != null && info.roe > 0 && (info.net_margin == null || info.net_margin > 0)) add(supports, "profit", `Profitable (ROE ${pc(info.roe)})`);

    // 3. Analysts: average 12-month target versus today's price, and the average rating
    const price = c.row && c.row.price;
    if (info.target != null && price) {
      const up = info.target / price - 1;
      if (up >= 0.10) add(supports, "target", `Analysts' average target is ${pc(up)} above the price`);
      else if (up < 0) add(cautions, "target", `Analysts' average target is below the price (${pc(up)})`);
    }
    if (info.rec != null) {
      if (info.rec <= 2.5) add(supports, "rating", `Analysts rate it Buy or better (${info.rec.toFixed(1)}/5)`);
      else if (info.rec >= 3.5) add(cautions, "rating", `Analysts rate it Hold or worse (${info.rec.toFixed(1)}/5)`);
    }

    // 4. Expected earnings: forward P/E below trailing P/E means profits are expected to rise
    if (info.fwd_pe > 0 && info.pe > 0) {
      if (info.fwd_pe < info.pe * 0.95) add(supports, "earnings", `Earnings expected to grow (forward P/E ${info.fwd_pe.toFixed(1)} vs ${info.pe.toFixed(1)} trailing)`);
      else if (info.fwd_pe > info.pe * 1.05) add(cautions, "earnings", `Earnings expected to shrink (forward P/E ${info.fwd_pe.toFixed(1)} vs ${info.pe.toFixed(1)} trailing)`);
    }
    if (info.rev_growth != null) {
      if (info.rev_growth >= 0.03) add(supports, "sales", `Sales growing (${pc(info.rev_growth)})`);
      else if (info.rev_growth < 0) add(cautions, "sales", `Sales shrinking (${pc(info.rev_growth)})`);
    }

    // 5. Valuation not stretched (only meaningful for profitable companies)
    if (info.fwd_pe > 0 && info.fwd_pe <= 25 && !loss) add(supports, "value", `Forward P/E of ${info.fwd_pe.toFixed(1)} is not stretched`);
    else if (info.fwd_pe > 45) add(cautions, "value", `Expensive: forward P/E of ${info.fwd_pe.toFixed(1)}`);

    // 6. A pullback, or a longer slide? Still up over six months and not in a downtrend = pullback.
    const r = c.row || {};
    if (Number.isFinite(r.ret_126)) {
      if (r.ret_126 > 0 && r.trend >= 1) add(supports, "trend", `Still up ${pc(r.ret_126)} over 6 months: a pullback, not a long slide`);
      else if (r.ret_126 <= 0 || r.trend === 0) add(cautions, "trend", `Longer slide: ${pc(r.ret_126)} over 6 months${r.trend === 0 ? ", below its 200-day average" : ""}`);
    }
    const upside = info.target != null && price ? info.target / price - 1 : null;
    return { supports, cautions, upside, net: supports.length - cautions.length };
  }

  /* cands: [{t, row, info, news}]. A "fall" means the return over the window is at or below -minDrop.
     ETFs and stocks without company data are left out (there is nothing to judge prospects with). */
  function screen(cands, { window = "1m", minDrop = 0.10, limit = 25 } = {}) {
    const w = WINDOWS[window];
    if (!w) throw new Error("unknown window " + window);
    const fell = cands.filter((c) => c.info && c.info.type !== "ETF" && c.row && Number.isFinite(c.row[w.key]) && c.row[w.key] <= -Math.abs(minDrop));
    const scored = fell.map((c) => {
      const a = assess(c), drop = c.row[w.key];
      if (drop <= -SHARP[window]) {
        a.cautions.push({ key: "sharp", text: `Very sharp fall (${pc(drop)} in ${w.label}): analyst targets and ratings lag the price, so the upside can look larger than it is` });
        a.net -= 1;
      }
      return { ...c, drop, ...a };
    });
    scored.sort((a, b) => b.net - a.net || b.supports.length - a.supports.length || (b.upside ?? -9) - (a.upside ?? -9) || a.drop - b.drop);
    return { total: fell.length, shown: scored.slice(0, limit), window: w };
  }

  const api = { WINDOWS, assess, screen };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Pullbacks = api;
})(typeof self !== "undefined" ? self : this);
