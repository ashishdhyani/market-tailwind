/* Portfolio risk and stress test. Pure maths on price history, no DOM.

   Given positions (ticker + weight) and each one's daily prices, it reports how much the basket has swung, how bad
   its worst stretches were, how much the positions move together, and what a market fall would likely do to it.
   Everything is measured on the history we have (since 2020), with the weights held constant. It describes the past;
   it is not a forecast, and a calm past does not guarantee a calm future. */
(function (root) {
  "use strict";

  const TRADING_DAYS = 252;
  const WINDOW = 756;       // about three years of history
  const MIN_DAYS = 120;     // below this the numbers are too noisy to show

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  function std(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  }
  function cov(a, b) {
    const ma = mean(a), mb = mean(b);
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
    return a.length > 1 ? s / (a.length - 1) : 0;
  }
  const corr = (a, b) => { const d = std(a) * std(b); return d > 0 ? cov(a, b) / d : null; };

  function maxDrawdown(returns) {
    let eq = 1, peak = 1, dd = 0;
    for (const r of returns) { eq *= 1 + r; if (eq > peak) peak = eq; dd = Math.min(dd, eq / peak - 1); }
    return dd;
  }

  /* Worst compounded return over any k consecutive days, and where it started: {value, start} (start = index into r). */
  function worstWindow(r, k) {
    if (r.length < k) return null;
    let best = Infinity, at = 0, prod = 1;
    const eq = [1];
    for (const x of r) eq.push(eq[eq.length - 1] * (1 + x));
    for (let s = 0; s + k <= r.length; s++) {
      const v = eq[s + k] / eq[s] - 1;
      if (v < best) { best = v; at = s; }
    }
    return { value: best, start: at };
  }
  const windowReturn = (r, start, k) => { let p = 1; for (let i = start; i < start + k; i++) p *= 1 + r[i]; return p - 1; };

  /* positions: [{t, w}] (weights are scaled to sum to 1). series(t) -> Float64Array of prices aligned with `dates`.
     bench: Float64Array of the comparison index. Returns { error } or the report. */
  function riskReport({ positions, series, bench, dates, window = WINDOW, minDays = MIN_DAYS }) {
    if (!positions || !positions.length) return { error: "No positions to measure." };
    const sumW = positions.reduce((a, p) => a + p.w, 0);
    if (!(sumW > 0)) return { error: "The positions have no value." };
    const pos = positions.map((p) => ({ t: p.t, w: p.w / sumW, p: series(p.t) }));
    if (pos.some((x) => !x.p)) return { error: `No price history for ${pos.filter((x) => !x.p).map((x) => x.t).join(", ")}.` };
    const n = dates.length, start = Math.max(1, n - window);

    // Days on which every position and the benchmark has a daily return.
    const ret = (p, i) => { const a = p[i], b = p[i - 1]; return a === a && b === b && b > 0 ? a / b - 1 : NaN; };
    const days = [];
    for (let i = start; i < n; i++) {
      if (bench && Number.isNaN(ret(bench, i))) continue;
      if (pos.every((x) => !Number.isNaN(ret(x.p, i)))) days.push(i);
    }
    // The shortest-history position limits the window: name it so the user knows why it is short.
    const counts = pos.map((x) => { let c = 0; for (let i = start; i < n; i++) if (!Number.isNaN(ret(x.p, i))) c++; return { t: x.t, c }; });
    const limiting = counts.reduce((a, b) => (b.c < a.c ? b : a));
    if (days.length < minDays) return { error: `Not enough shared price history (${days.length} days; at least ${minDays} are needed). ${limiting.t} has the shortest history.` };

    const R = pos.map((x) => days.map((i) => ret(x.p, i)));
    const rb = bench ? days.map((i) => ret(bench, i)) : null;
    const rp = days.map((_, d) => pos.reduce((s, x, k) => s + x.w * R[k][d], 0));
    const sigmaP = std(rp), vols = R.map(std);

    const varP = sigmaP * sigmaP;
    const contributions = pos.map((x, k) => ({ t: x.t, w: x.w, vol: vols[k] * Math.sqrt(TRADING_DAYS), share: varP > 0 ? (x.w * cov(R[k], rp)) / varP : 1 / pos.length }))
      .sort((a, b) => b.share - a.share);
    let corrSum = 0, corrN = 0;
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const c = corr(R[i], R[j]); if (c != null) { corrSum += c; corrN++; } }
    const wavgVol = pos.reduce((s, x, k) => s + x.w * vols[k], 0);

    const w21 = worstWindow(rp, 21), b21 = rb ? worstWindow(rb, 21) : null, b63 = rb ? worstWindow(rb, 63) : null;
    const beta = rb && std(rb) > 0 ? cov(rp, rb) / (std(rb) * std(rb)) : null;
    const replay = (label, bw, k) => bw && days.length >= k ? { label, from: dates[days[bw.start]], to: dates[days[bw.start + k - 1]], basket: windowReturn(rp, bw.start, k), bench: bw.value } : null;

    return {
      days: days.length, from: dates[days[0]], to: dates[days[days.length - 1]], limiting: limiting.t,
      vol: sigmaP * Math.sqrt(TRADING_DAYS), benchVol: rb ? std(rb) * Math.sqrt(TRADING_DAYS) : null,
      maxDD: maxDrawdown(rp), benchMaxDD: rb ? maxDrawdown(rb) : null,
      worstDay: Math.min(...rp), worst21: w21 ? w21.value : null, benchWorst21: b21 ? b21.value : null,
      beta, avgCorr: corrN ? corrSum / corrN : null,
      divRatio: sigmaP > 0 ? wavgVol / sigmaP : 1,
      effN: 1 / pos.reduce((s, x) => s + x.w * x.w, 0),
      contributions,
      stress: beta == null ? [] : [-0.10, -0.20, -0.30].map((shock) => ({ shock, est: beta * shock })),
      replays: [replay("Worst month for the market", b21, 21), replay("Worst quarter for the market", b63, 63)].filter(Boolean),
    };
  }

  const api = { riskReport, maxDrawdown, worstWindow, std, cov, corr, WINDOW, MIN_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Risk = api;
})(typeof self !== "undefined" ? self : this);
