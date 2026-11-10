/* Options analysis for the Lookup tab. Pure (no DOM, no network), so it runs in Node tests.

   Input is the raw per-contract data written by lookup.py (strike, last price, bid, ask, volume, open interest, last trade
   date). Yahoo's own implied-volatility column is NOT used: outside market hours it holds placeholder values (0.00001,
   0.125 ...) next to zero bid/ask, so implied volatility is solved here with Black-Scholes from the prices that traded.
   That means these are estimates: a flat 4% interest rate, no dividends, and last-traded prices when no live quote exists.

   What it can say: how big a move the options market is pricing in, how expensive options are compared with the stock's
   recent swings, put/call balance, unusual volume, where open interest is stacked. What it cannot say: who bought or sold,
   so none of it is a direction forecast. */
(function (root) {
  "use strict";

  const RATE = 0.04;
  const IV_MIN = 0.05, IV_MAX = 4;                 // implied volatilities outside this are treated as bad data
  const UNUSUAL = { minVolume: 200, minPremium: 50000, top: 8 };
  const THIN_VOLUME = 200;
  const MULT = 100;                                // shares per contract

  /* ---------- reading the file ---------- */
  const nm = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
  const nonNeg = (v) => (nm(v) !== null && v >= 0 ? v : null);

  function contracts(rows) {
    const out = [];
    for (const r of (Array.isArray(rows) ? rows : []).slice(0, 600)) {
      if (!Array.isArray(r) || !(nm(r[0]) > 0)) continue;
      out.push({ k: r[0], last: nonNeg(r[1]), bid: nonNeg(r[2]), ask: nonNeg(r[3]), vol: nonNeg(r[4]) || 0, oi: nonNeg(r[5]) || 0, t: isDate(r[7]) ? r[7] : null });
    }
    return out.sort((a, b) => a.k - b.k);
  }

  /* raw: the "options" object from lookup.py -> { spot, expiries: [{ date, calls, puts }] } or null */
  function sanitize(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.expiries)) return null;
    const expiries = raw.expiries.slice(0, 14).filter((e) => e && isDate(e.date))
      .map((e) => ({ date: e.date, calls: contracts(e.calls), puts: contracts(e.puts) }))
      .filter((e) => e.calls.length || e.puts.length).sort((a, b) => (a.date < b.date ? -1 : 1));
    return expiries.length ? { spot: nm(raw.spot) > 0 ? raw.spot : null, expiries } : null;
  }

  /* ---------- Black-Scholes ---------- */
  function erf(x) {                                 // Abramowitz and Stegun 7.1.26, error below 1.5e-7
    const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  }
  const cdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

  function bsPrice(type, S, K, T, sigma, r = RATE) {
    const sd = sigma * Math.sqrt(T), d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sd, d2 = d1 - sd, df = Math.exp(-r * T);
    return type === "call" ? S * cdf(d1) - K * df * cdf(d2) : K * df * cdf(-d2) - S * cdf(-d1);
  }

  /* Volatility that makes Black-Scholes match the price. null when the price is outside what any volatility could give. */
  function impliedVol(type, price, S, K, T, r = RATE) {
    if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
    let lo = 0.01, hi = IV_MAX + 1;
    if (bsPrice(type, S, K, T, lo, r) > price || bsPrice(type, S, K, T, hi, r) < price) return null;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      if (bsPrice(type, S, K, T, mid, r) < price) lo = mid; else hi = mid;
    }
    const v = (lo + hi) / 2;
    return v >= IV_MIN && v <= IV_MAX ? v : null;
  }

  /* ---------- helpers ---------- */
  const dayDiff = (a, b) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5;

  /* A usable price for a contract: the mid of a sane live quote, else the last trade if it happened in the latest session. */
  function mark(c, session) {
    if (c.bid > 0 && c.ask > 0 && c.ask >= c.bid) { const mid = (c.bid + c.ask) / 2; if ((c.ask - c.bid) / mid <= 0.5) return mid; }
    return c.last > 0 && c.t === session ? c.last : null;
  }

  /* Implied volatility at one strike, from the out-of-the-money side (puts below the price, calls above: the more reliable one). */
  function ivAtStrike(exp, K, spot, T, session) {
    const isCall = K >= spot, list = isCall ? exp.calls : exp.puts, c = list.find((x) => x.k === K);
    if (!c) return null;
    const p = mark(c, session);
    return p ? impliedVol(isCall ? "call" : "put", p, spot, K, T) : null;
  }

  /* At-the-money volatility: the two strikes either side of the price, interpolated. */
  function atmIv(exp, spot, T, session) {
    const ks = [...new Set([...exp.calls, ...exp.puts].map((c) => c.k))].filter((k) => Math.abs(k / spot - 1) <= 0.15).sort((a, b) => a - b);
    let below = null, above = null;
    for (const k of ks) { if (k <= spot) { const v = ivAtStrike(exp, k, spot, T, session); if (v) below = { k, v }; } }
    for (const k of [...ks].reverse()) { if (k >= spot) { const v = ivAtStrike(exp, k, spot, T, session); if (v) above = { k, v }; } }
    if (below && above) return below.k === above.k ? below.v : below.v + (above.v - below.v) * (spot - below.k) / (above.k - below.k);
    return (below || above || {}).v ?? null;
  }

  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

  /* ---------- the analysis ----------
     ctx: { spotOn (function: ISO date -> price that day) or spot, session (ISO date of the latest trading session in the data), earnings (ISO date | null),
            realizedVol (annualised, 3 months | null), isEtf } */
  function analyze(opts, ctx) {
    if (!opts || !opts.expiries.length) return null;
    const all = opts.expiries.flatMap((e) => [...e.calls, ...e.puts]);
    const traded = all.map((c) => c.t).filter(Boolean).sort();
    const session = ctx.session || traded[traded.length - 1];
    const spot = (ctx.spotOn && ctx.spotOn(session)) || ctx.spot || opts.spot;
    if (!session || !(spot > 0)) return null;
    const isToday = (c) => c.t === session;
    const out = { session, spot, rate: RATE, quotesLive: all.some((c) => c.bid > 0 && c.ask > 0), notes: [] };

    // per-expiry volatility and expected move
    const rows = [];
    for (const e of opts.expiries) {
      const days = dayDiff(session, e.date);
      if (days < 1) continue;
      const T = days / 365, iv = atmIv(e, spot, T, session);
      const move = iv ? spot * iv * Math.sqrt(T) : null;
      rows.push({ date: e.date, days, T, iv, move, movePct: move ? move / spot : null, low: move ? spot - move : null, high: move ? spot + move : null,
        earnings: !!(ctx.earnings && ctx.earnings >= session && e.date >= ctx.earnings), exp: e });
    }
    const valid = rows.filter((r) => r.iv);
    if (!valid.length) { out.expiries = rows.map(({ exp, ...r }) => r); out.noVol = true; }
    else out.expiries = rows.map(({ exp, ...r }) => r);
    const head = valid.find((r) => r.days >= 7) || valid[0] || null;
    out.headline = head ? { date: head.date, days: head.days, iv: head.iv, move: head.move, movePct: head.movePct, low: head.low, high: head.high } : null;

    // earnings: the extra variance an expiry just after earnings carries over a clean expiry before it. Only worked out when both
    // expiries sit close to the date (an expiry months later mixes in too much else, so the figure would be noise).
    out.earnings = null;
    if (ctx.earnings && ctx.earnings >= session) {
      const after = valid.find((r) => r.date >= ctx.earnings && dayDiff(ctx.earnings, r.date) <= 21);
      const before = after && [...valid].reverse().find((r) => r.date < ctx.earnings && r.days >= 2 && dayDiff(r.date, ctx.earnings) <= 60);
      if (after) {
        out.earnings = { date: ctx.earnings, expiry: after.date, days: after.days, totalMovePct: after.movePct, jumpPct: null };
        if (before && after.iv > before.iv) out.earnings.jumpPct = Math.sqrt(after.T * (after.iv * after.iv - before.iv * before.iv));
      }
    }

    // implied vs realised volatility and the shape across time
    const far = [...valid].reverse().find((r) => r.days >= 60);
    out.iv = null;
    if (head) {
      const real = ctx.realizedVol > 0 ? ctx.realizedVol : null, ratio = real ? head.iv / real : null;
      const term = far && far !== head ? (head.iv > far.iv * 1.1 ? "inverted" : far.iv > head.iv * 1.1 ? "normal" : "flat") : null;
      out.iv = { value: head.iv, days: head.days, realized: real, ratio, word: ratio === null ? null : ratio > 1.3 ? "high" : ratio < 0.8 ? "low" : "in line", near: head.iv, far: far && far !== head ? far.iv : null, farDays: far && far !== head ? far.days : null, term };
    }

    // put/call balance (volume: the latest session only; open interest: all)
    const sess = (list) => list.filter(isToday);
    const cv = sum(opts.expiries, (e) => sum(sess(e.calls), (c) => c.vol)), pv = sum(opts.expiries, (e) => sum(sess(e.puts), (c) => c.vol));
    const coi = sum(opts.expiries, (e) => sum(e.calls, (c) => c.oi)), poi = sum(opts.expiries, (e) => sum(e.puts, (c) => c.oi));
    const prem = (list) => sum(sess(list).filter((c) => c.last > 0), (c) => c.vol * c.last * MULT);
    const callPrem = sum(opts.expiries, (e) => prem(e.calls)), putPrem = sum(opts.expiries, (e) => prem(e.puts));
    const ratio = cv > 0 ? pv / cv : null;
    const thin = cv + pv < THIN_VOLUME;
    const bands = ctx.isEtf ? [0.7, 1.2, 1.8] : [0.45, 0.9, 1.3];
    out.pc = { callVol: cv, putVol: pv, volRatio: ratio, callOI: coi, putOI: poi, oiRatio: coi > 0 ? poi / coi : null, callPremium: callPrem, putPremium: putPrem, thin, expiries: opts.expiries.length,
      word: ratio === null ? null : ratio < bands[0] ? "calls dominate" : ratio < bands[1] ? "more calls than puts" : ratio < bands[2] ? "leaning to puts" : "puts dominate", typical: ctx.isEtf ? "0.7 to 1.2" : "0.45 to 0.9" };

    // unusual activity: today's volume at least as large as everything already open on that contract
    const unusual = [];
    let noOi = 0;
    for (const e of opts.expiries) {
      const days = dayDiff(session, e.date);
      if (days < 0) continue;
      for (const [type, list] of [["call", e.calls], ["put", e.puts]]) {
        for (const c of list) {
          if (!isToday(c) || c.vol < UNUSUAL.minVolume || !(c.last > 0)) continue;
          if (c.oi <= 0) { if (c.vol >= 1000) noOi++; continue; }          // open interest missing: cannot compare
          const premium = c.vol * c.last * MULT;
          if (c.vol >= c.oi && premium >= UNUSUAL.minPremium) {
            const otm = type === "call" ? c.k / spot - 1 : 1 - c.k / spot;
            unusual.push({ type, strike: c.k, expiry: e.date, days, vol: c.vol, oi: c.oi, ratio: c.vol / c.oi, premium, otmPct: otm, last: c.last, lottery: otm > 0.15 && days <= 14 });
          }
        }
      }
    }
    unusual.sort((a, b) => b.premium - a.premium);
    out.unusual = { rows: unusual.slice(0, UNUSUAL.top), total: unusual.length, calls: unusual.filter((u) => u.type === "call").length, puts: unusual.filter((u) => u.type === "put").length,
      callPremium: sum(unusual.filter((u) => u.type === "call"), (u) => u.premium), putPremium: sum(unusual.filter((u) => u.type === "put"), (u) => u.premium), skippedNoOi: noOi };

    // open-interest "walls" over the next 60 days
    const wall = (side) => {
      const m = new Map();
      for (const e of opts.expiries) {
        const d = dayDiff(session, e.date);
        if (d < 1 || d > 60) continue;
        for (const c of e[side]) m.set(c.k, (m.get(c.k) || 0) + c.oi);
      }
      const total = [...m.values()].reduce((s, v) => s + v, 0);
      return { total, top: [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, oi]) => ({ strike: k, oi, share: total ? oi / total : 0, distPct: k / spot - 1 })) };
    };
    out.walls = { calls: wall("calls"), puts: wall("puts") };

    // skew: what a put 10% below the price costs (in volatility) against a call 10% above, in the headline expiry
    out.skew = null;
    if (head) {
      const nearest = (list, target) => list.reduce((b, c) => (!b || Math.abs(c.k - target) < Math.abs(b.k - target) ? c : b), null);
      const pc = nearest(head.exp.puts.filter((c) => c.vol >= 10 && c.last >= 0.05), spot * 0.9), cc = nearest(head.exp.calls.filter((c) => c.vol >= 10 && c.last >= 0.05), spot * 1.1);
      if (pc && cc && Math.abs(pc.k / spot - 0.9) < 0.06 && Math.abs(cc.k / spot - 1.1) < 0.06) {
        const pi = ivAtStrike(head.exp, pc.k, spot, head.T, session), ci = ivAtStrike(head.exp, cc.k, spot, head.T, session);
        if (pi && ci) { const v = pi - ci; out.skew = { value: v, putIv: pi, callIv: ci, putStrike: pc.k, callStrike: cc.k, expiry: head.date, word: v > 0.05 ? "puts pricier" : v < -0.03 ? "calls pricier" : "balanced" }; }
      }
    }

    // data quality
    if (!out.quotesLive) out.notes.push(`The market was closed when this was fetched, so there are no live bid/ask quotes. Figures use the prices options last traded at on ${session}.`);
    if (thin) out.notes.push("Very few contracts traded in the latest session, so the put/call and unusual-activity figures are not meaningful.");
    if (noOi) out.notes.push(`Yahoo shows no open interest for ${noOi} heavily traded contract${noOi === 1 ? "" : "s"} (usually ones expiring very soon), so they are left out of the unusual-activity list.`);
    if (!head) out.notes.push("No usable option prices to work out implied volatility (the contracts near the price did not trade recently).");
    return out;
  }

  const api = { RATE, UNUSUAL, THIN_VOLUME, sanitize, bsPrice, impliedVol, mark, atmIv, analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LookupOptions = api;
})(typeof self !== "undefined" ? self : this);
