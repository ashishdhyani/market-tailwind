/* Pure helpers for the "My Holdings" tab: parse a CSV or pasted rows, summarise concentration, and compare
   today's signals with the previous update. No DOM and no network, so it is easy to test.
   Holdings never leave the browser; nothing here sends or stores anything. */
(function (root) {
  "use strict";

  const MAX_HOLDINGS = 200;
  const TICKER = /^[A-Z][A-Z0-9.\-/]{0,11}$/;
  const HEADER_WORDS = {
    ticker: ["ticker", "symbol", "stock", "code", "instrument"],
    qty: ["qty", "quantity", "shares", "units", "position", "holding"],
    cost: ["cost", "avgcost", "averagecost", "avgprice", "averageprice", "price", "buyprice", "costbasis"],
  };

  const num = (s) => {
    if (s == null || String(s).trim() === "") return null;
    const v = Number(String(s).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
    return Number.isFinite(v) ? v : null;
  };

  function splitLine(line) {
    // Quoted numbers such as "1,234.50" lose their comma first. A line with commas / semicolons / tabs is split
    // only on those (so a header like "Avg Price" stays one column and empty fields keep their position);
    // otherwise it is split on spaces.
    const cleaned = line.replace(/"([^"]*)"/g, (m, inner) => (/^[\d,.\s$()\-]+$/.test(inner) ? inner.replace(/,/g, "") : inner));
    return /[,;\t]/.test(cleaned) ? cleaned.split(/[,;\t]/).map((t) => t.trim()) : cleaned.split(/\s+/).filter(Boolean);
  }

  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

  /* text: pasted rows or a CSV file. known: Set of tickers the app has data for (maps "D05" to "D05.SI").
     Returns { holdings: [{t, qty, cost}], rejected: [{line, reason}] }. */
  function parseHoldings(text, known = new Set()) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const out = new Map(), rejected = [];
    let cols = { ticker: 0, qty: 1, cost: 2 };

    lines.forEach((line, i) => {
      const toks = splitLine(line);
      if (i === 0) {  // header row, e.g. "Symbol, Quantity, Avg Price"
        const names = toks.map(norm);
        const idx = (k) => names.findIndex((n) => HEADER_WORDS[k].includes(n));
        if (idx("ticker") >= 0 && (idx("qty") >= 0 || idx("cost") >= 0)) {
          cols = { ticker: idx("ticker"), qty: idx("qty"), cost: idx("cost") };
          return;
        }
      }
      let t = (toks[cols.ticker] || "").toUpperCase().replace(/^\$/, "");
      if (!TICKER.test(t)) { rejected.push({ line, reason: "not a ticker symbol" }); return; }
      if (!known.has(t) && known.has(t + ".SI")) t += ".SI";                       // D05 -> D05.SI
      else if (!known.has(t) && known.has(t.replace(/[./]/g, "-"))) t = t.replace(/[./]/g, "-"); // BRK.B -> BRK-B (Yahoo form)
      const qty = cols.qty >= 0 ? num(toks[cols.qty]) : null;
      const cost = cols.cost >= 0 ? num(toks[cols.cost]) : null;
      if (qty != null && qty <= 0) { rejected.push({ line, reason: "shares must be above zero" }); return; }
      if (cost != null && cost <= 0) { rejected.push({ line, reason: "cost must be above zero" }); return; }
      const prev = out.get(t);
      if (!prev) out.set(t, { t, qty, cost });
      else {  // same ticker twice: add the shares, average the cost by shares
        const q = (prev.qty || 0) + (qty || 0);
        const c = prev.cost != null && cost != null && prev.qty && qty ? (prev.cost * prev.qty + cost * qty) / q : prev.cost ?? cost;
        out.set(t, { t, qty: q || null, cost: c ?? null });
      }
    });
    if (out.size > MAX_HOLDINGS) rejected.push({ line: "", reason: `only the first ${MAX_HOLDINGS} holdings are kept` });
    return { holdings: [...out.values()].slice(0, MAX_HOLDINGS), rejected };
  }

  function toCsv(holdings) {
    return "ticker,shares,cost\n" + holdings.map((h) => [h.t, h.qty ?? "", h.cost ?? ""].join(",")).join("\n") + "\n";
  }

  /* rows: [{t, value, currency, group}]. Weights are within each currency (no FX conversion). */
  function summarize(rows) {
    const by = {};
    for (const r of rows) {
      if (!(r.value > 0)) continue;
      const c = (by[r.currency] ||= { currency: r.currency, total: 0, items: [], groups: {} });
      c.total += r.value; c.items.push(r);
      c.groups[r.group || "Other"] = (c.groups[r.group || "Other"] || 0) + r.value;
    }
    return Object.values(by).map((c) => {
      const items = c.items.map((r) => ({ t: r.t, weight: r.value / c.total })).sort((a, b) => b.weight - a.weight);
      const groups = Object.entries(c.groups).map(([name, v]) => ({ name, weight: v / c.total })).sort((a, b) => b.weight - a.weight);
      return { currency: c.currency, total: c.total, count: items.length, top: items[0], items, groups };
    });
  }

  /* ---- "what changed since the previous update" ---- */

  const RANK_ORDER = ["top 5", "top third", "middle third", "bottom third"];
  function rankBucket(rank, total) {
    if (!rank || !total) return null;
    return rank <= 5 ? "top 5" : rank <= total / 3 ? "top third" : rank <= (2 * total) / 3 ? "middle third" : "bottom third";
  }

  /* sig: { trend, rank:{n,of}|null, news:{word,n}|null, fund, price } -> compact snapshot entry */
  function snapshotEntry(sig) {
    return {
      trend: sig.trend || null,
      rank: sig.rank ? rankBucket(sig.rank.n, sig.rank.of) : null,
      news: sig.news && sig.news.n >= 3 ? sig.news.word : null,   // too few headlines to call a tone
      fund: sig.fund || null,
      price: sig.price ?? null,
    };
  }

  const TONE_ORDER = ["weaker than most", "about average", "better than most"];
  const TREND_ORDER = ["Downtrend", "Mixed trend", "Strong uptrend"];
  const FUND_ORDER = ["Weak", "Mixed", "Strong"];
  const arrow = (order, a, b) => (order.indexOf(b) > order.indexOf(a) ? "▲" : "▼");

  /* Compare two snapshots ({asOf, items:{T: entry}}). Wording is descriptive: what moved, never what to do. */
  function diffSnapshots(prev, cur, priceMovePct = 5) {
    const changes = [];
    if (!prev || !cur) return changes;
    for (const [t, c] of Object.entries(cur.items)) {
      const p = prev.items[t];
      if (!p) continue;
      if (p.trend && c.trend && p.trend !== c.trend) changes.push({ t, kind: "trend", dir: arrow(TREND_ORDER, p.trend, c.trend), text: `Trend changed from ${p.trend.toLowerCase()} to ${c.trend.toLowerCase()}.` });
      if (p.rank && c.rank && p.rank !== c.rank) changes.push({ t, kind: "rank", dir: arrow(RANK_ORDER.slice().reverse(), p.rank, c.rank), text: `Moved from the ${p.rank} to the ${c.rank} of the tracked watchlist ranking.` });
      if (p.news && c.news && p.news !== c.news) changes.push({ t, kind: "news", dir: arrow(TONE_ORDER, p.news, c.news), text: `News tone moved from ${p.news} to ${c.news} (versus other stocks).` });
      if (p.fund && c.fund && p.fund !== c.fund) changes.push({ t, kind: "fund", dir: arrow(FUND_ORDER, p.fund, c.fund), text: `Fundamentals check changed from ${p.fund.toLowerCase()} to ${c.fund.toLowerCase()}.` });
      if (p.price > 0 && c.price > 0) {
        const mv = (c.price / p.price - 1) * 100;
        if (Math.abs(mv) >= priceMovePct) changes.push({ t, kind: "price", dir: mv > 0 ? "▲" : "▼", text: `Price moved ${mv > 0 ? "+" : ""}${mv.toFixed(1)}% since the previous update.` });
      }
    }
    return changes;
  }

  /* Keep the comparison stable all day: a new baseline is only taken when a NEW data update arrives, so
     visiting twice shows the same changes. Returns the snapshots to store. */
  function rollSnapshots(storedLast, storedSeen, cur) {
    if (!storedLast) return { last: cur, seen: null };
    if (storedLast.asOf !== cur.asOf) return { last: cur, seen: storedLast };
    return { last: cur, seen: storedSeen || null };
  }

  /* ---------- cash planner: arithmetic only ----------
     The user picks the tickers (and optionally the weights); this turns "cash + basket" into whole shares and
     dollar amounts. It never chooses what to buy. */

  /* "NVDA 40", "MSFT, 30%", "XOM": ticker with an optional percentage weight. */
  function parseBasket(text, known = new Set()) {
    const out = new Map(), rejected = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const toks = splitLine(line);
      let t = (toks[0] || "").toUpperCase().replace(/^\$/, "");
      if (!TICKER.test(t)) { rejected.push({ line, reason: "not a ticker symbol" }); continue; }
      if (!known.has(t) && known.has(t + ".SI")) t += ".SI";
      else if (!known.has(t) && known.has(t.replace(/[./]/g, "-"))) t = t.replace(/[./]/g, "-");
      const w = toks[1] === undefined || toks[1] === "" ? null : num(String(toks[1]).replace(/%$/, ""));
      if (toks[1] !== undefined && toks[1] !== "" && (w == null || w <= 0 || w > 100)) { rejected.push({ line, reason: "weight must be between 0 and 100" }); continue; }
      out.set(t, { t, weight: w });
    }
    return { items: [...out.values()].slice(0, 30), rejected };
  }

  const cents = (x) => Math.round(x * 100) / 100;

  /* cash: money to invest. reservePct: share to keep in cash. fee: cost per order. fractional: allow part shares.
     items: [{t, price, weight|null}] (weights are percentages of the money invested; blanks split what is left).
     Returns { rows, totals, warnings } or { error }. */
  function planBasket({ cash, reservePct = 0, fee = 0, fractional = false, items }) {
    if (!(cash > 0) || !Number.isFinite(cash)) return { error: "Enter an amount of cash above zero." };
    if (!(reservePct >= 0 && reservePct <= 90)) return { error: "Cash to keep back must be between 0% and 90%." };
    if (!(fee >= 0) || !Number.isFinite(fee)) return { error: "The fee per order cannot be negative." };
    if (!items || !items.length) return { error: "Add at least one ticker to the basket." };
    if (items.some((i) => !(i.price > 0))) return { error: "Every ticker needs a price." };

    const given = items.filter((i) => i.weight != null), blank = items.length - given.length;
    const sumGiven = given.reduce((a, i) => a + i.weight, 0);
    let w;
    if (blank === 0) w = items.map((i) => (i.weight / sumGiven) * 100);                 // relative weights, scaled to 100%
    else if (given.length === 0) w = items.map(() => 100 / items.length);
    else if (sumGiven >= 100 - 1e-9) return { error: `The weights you gave already use ${sumGiven.toFixed(0)}%. Give the others a weight too, or lower these.` };
    else w = items.map((i) => (i.weight != null ? i.weight : (100 - sumGiven) / blank));

    const reserveCash = cents((cash * reservePct) / 100), investable = cash - reserveCash;
    const rows = items.map((i, k) => ({ t: i.t, price: i.price, weight: w[k], target: (investable * w[k]) / 100, shares: 0, cost: 0, note: "" }));
    const buy = (r, shares) => { r.shares = shares; r.cost = cents(shares * r.price + (shares > 0 ? fee : 0)); };

    for (const r of rows) {
      const usable = r.target - fee;
      const shares = usable > 0 ? (fractional ? Math.floor((usable / r.price) * 100) / 100 : Math.floor(usable / r.price)) : 0;
      buy(r, shares);
      if (shares === 0) r.note = fractional ? "This slot is too small to cover the fee." : `One share (${r.price.toFixed(2)}) costs more than this slot.`;
    }
    // Whole shares leave crumbs: spend them on the most under-filled slots, never touching the cash to keep back.
    if (!fractional) {
      for (;;) {
        const room = cash - reserveCash - rows.reduce((a, r) => a + r.cost, 0);
        const cand = rows.filter((r) => r.price + (r.shares === 0 ? fee : 0) <= room + 1e-9)
          .sort((a, b) => (b.target - b.shares * b.price) - (a.target - a.shares * a.price))[0];
        if (!cand || cand.target - cand.shares * cand.price <= 0) break;   // stop once every slot is at or over its target
        buy(cand, cand.shares + 1); cand.note = "";
      }
    }
    const invested = cents(rows.reduce((a, r) => a + r.cost, 0));
    const fees = cents(rows.reduce((a, r) => a + (r.shares > 0 ? fee : 0), 0));
    rows.forEach((r) => { r.pctOfCash = (r.cost / cash) * 100; r.target = cents(r.target); });
    const warnings = [];
    if (rows.some((r) => r.shares === 0)) warnings.push("Some slots could not buy a share at this amount.");
    return { rows, totals: { cash, reserveCash, invested, fees, cashLeft: cents(cash - invested) }, warnings };
  }

  const api = { parseBasket, planBasket, parseHoldings, toCsv, summarize, rankBucket, snapshotEntry, diffSnapshots, rollSnapshots, MAX_HOLDINGS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Holdings = api;
})(typeof self !== "undefined" ? self : this);
