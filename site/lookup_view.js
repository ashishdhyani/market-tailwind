/* Builds the Lookup report as an HTML string from a sanitised report and its analysis (see lookup.js). Pure (no DOM),
   so it can be tested in Node. Every value is escaped; links are limited to http(s) and open in a new tab. */
(function (root) {
  "use strict";
  const E = typeof require !== "undefined" ? require("./engine.js") : root.Engine;
  const F = typeof require !== "undefined" ? require("./fundamentals.js") : root.Fundamentals;
  const L = typeof require !== "undefined" ? require("./lookup.js") : root.Lookup;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const sp = (v, d = 1) => (isNum(v) ? E.pct(v, d, true) : "–");
  const pc = (v, d = 0) => (isNum(v) ? E.pct(v, d) : "–");
  const cls = (v) => (isNum(v) ? (v > 0 ? "pos" : v < 0 ? "neg" : "") : "");
  const TAG = { good: "Good", ok: "Fair", bad: "Weak" };

  /* Money with a currency label: $ and S$ for USD/SGD, otherwise the code (TWD 3.81T). */
  function big(n, cur) {
    if (!isNum(n)) return "–";
    if (cur === "USD" || cur === "SGD") return F.money(n, cur);
    const a = Math.abs(n), [v, u] = a >= 1e12 ? [a / 1e12, "T"] : a >= 1e9 ? [a / 1e9, "B"] : a >= 1e6 ? [a / 1e6, "M"] : [a, ""];
    return (n < 0 ? "-" : "") + (cur ? cur + " " : "") + (u ? v.toFixed(v >= 100 ? 0 : 1) + u : v.toFixed(2));
  }
  const px = (v, cur) => (isNum(v) ? (cur === "USD" ? "$" : cur === "SGD" ? "S$" : "") + v.toFixed(v >= 100 ? 2 : v >= 1 ? 2 : 4) + (cur && cur !== "USD" && cur !== "SGD" ? " " + cur : "") : "–");
  const ago = (iso, now) => { const h = (now - Date.parse(iso)) / 36e5; return h < 1 ? "just now" : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`; };
  const sec = (title, body, open = true) => `<details class="lk-sec"${open ? " open" : ""}><summary>${esc(title)}</summary><div class="lk-body">${body}</div></details>`;
  const link = (u, text) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  const table = (head, rows) => `<div class="tbl-wrap"><table class="lk-table"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const tr = (cells) => `<tr>${cells.map((c, i) => `<td${i ? ' class="num' + (c.c ? " " + c.c : "") + '"' : ""}>${i ? esc(c.t ?? c) : esc(c)}</td>`).join("")}</tr>`;

  function header(rep, A, now) {
    const p = rep.profile, s = A.stats, cur = p.currency || "USD";
    const day = s.prev ? s.price / s.prev - 1 : null;
    const bits = [p.exchange, p.type === "ETF" ? "ETF" : p.type === "EQUITY" ? "Stock" : p.type, p.sector, p.industry, p.country, p.category].filter(Boolean);
    const badge = A.inApp ? `<span class="tag sug">In this app: ranked #${A.inApp.rank} of ${A.inApp.of}${A.inApp.label ? " on the " + esc(A.inApp.label.toLowerCase()) + " horizon" : ""}</span>` : `<span class="tag">Not in this app's lists</span>`;
    const ev = A.ev && A.ev.summary && A.ev.summary.label !== "Not enough data" && p.type !== "ETF" ? `<span class="tag">Fundamentals: ${esc(A.ev.summary.label)} (${A.ev.summary.good}/${A.ev.summary.of})</span>` : "";
    return `<div class="lk-head"><div><h3 class="lk-title">${esc(p.name)} <span class="lk-sym">${esc(rep.symbol)}</span></h3><p class="muted">${bits.map(esc).join(" · ")}</p></div>`
      + `<div class="lk-price"><b>${esc(px(s.price, cur))}</b> <span class="${cls(day)}">${sp(day, 2)} today</span><br><span class="muted">as of ${esc(s.asOf)}</span></div></div>`
      + `<p class="lk-tags">${badge}${ev}</p>`;
  }

  function checksBlock(A) {
    const c = A.checks;
    const list = (items, kind) => (items.length ? `<ul class="lk-list ${kind}">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="muted">Nothing notable.</p>`);
    return `<div class="lk-cols"><div><h4>Points in its favour</h4>${list(c.good, "up")}</div><div><h4>Points of caution</h4>${list(c.bad, "down")}</div></div>`
      + (c.notes.length ? `<ul class="lk-notes">${c.notes.map((t) => `<li class="muted">${esc(t)}</li>`).join("")}</ul>` : "")
      + `<p class="muted">These are facts and rules of thumb from the data, listed so you can research further. They are not a recommendation, and a stock can look good on every line here and still fall.</p>`;
  }

  function priceBlock(rep, A) {
    const s = A.stats, rel = A.rel, pt = A.pct;
    const rows = L.WINDOWS.map(([k, label]) => tr([label, { t: sp(s.ret[k]), c: cls(s.ret[k]) }, rel ? { t: sp(rel.spy[k]), c: cls(rel.spy[k]) } : "–", rel ? { t: sp(rel.diff[k]), c: cls(rel.diff[k]) } : "–"]));
    const facts = [
      ["52-week range", `${px(s.lo52, rep.profile.currency)} to ${px(s.hi52, rep.profile.currency)} (${s.drawdown_1y !== null ? pc(-s.drawdown_1y) + " below the high" : "n/a"})`],
      ["50 / 200-day average", `${px(s.sma50, rep.profile.currency)} / ${px(s.sma200, rep.profile.currency)}`],
      ["Yearly swings (3 months)", s.vol_63d !== null ? pc(s.vol_63d) : "–"],
      ["Beta vs SPY (1 year)", rel && rel.beta !== undefined ? `${rel.beta.toFixed(2)} (correlation ${rel.corr.toFixed(2)})` : isNum(rep.info.beta) ? `${rep.info.beta.toFixed(2)} (Yahoo)` : "–"],
      ["Average daily volume", isNum(rep.extra.avg_volume) ? Math.round(rep.extra.avg_volume).toLocaleString("en-US") + " shares" : "–"],
    ].map(([a, b]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td></tr>`).join("");
    const share = (v) => (v == null ? "–" : `${Math.round(v * 100)}%`);
    const rank = pt ? `<p class="muted">Against the ${pt.of} stocks and ETFs this app tracks: its 6-month return beat ${share(pt.ret_126)} of them, its 3-month return ${share(pt.ret_63)}, it has been calmer than ${share(pt.calm)}, and it sits closer to its 1-year high than ${share(pt.near_high)}.</p>` : "";
    return `<div id="lk-chart" class="chart"></div>${table(["Window", "This", "SPY", "Difference"], rows)}<table class="lk-kv"><tbody>${facts}</tbody></table>${rank}`
      + `<p class="muted">Prices are adjusted for splits and dividends. ${s.n} trading days of history (${s.years.toFixed(1)} years).</p>`;
  }

  function metricsBlock(rep, A) {
    const ev = A.ev;
    if (!ev) return `<p class="muted">Yahoo returned no company numbers for this symbol.</p>`;
    const grid = `<div class="metrics">${ev.metrics.map((m) => `<div class="m ${m.status}" title="${esc(m.help || "")}"><span class="m-label">${esc(m.label)}</span><span class="m-val">${esc(m.text)}</span><span class="m-tag">${m.status === "na" ? "n/a" : TAG[m.status] || ""}</span></div>`).join("")}</div>`;
    const x = rep.extra, cur = rep.profile.currency, more = [
      ["Enterprise value", big(x.enterprise_value, cur)], ["Revenue (trailing)", big(x.revenue, rep.profile.financial_currency || cur)], ["EBITDA", big(x.ebitda, rep.profile.financial_currency || cur)],
      ["Cash", big(x.total_cash, rep.profile.financial_currency || cur)], ["Debt", big(x.total_debt, rep.profile.financial_currency || cur)], ["Book value / share", isNum(x.book_value) ? x.book_value.toFixed(2) : "–"],
      ["Shares outstanding", isNum(x.shares_out) ? big(x.shares_out, "") : "–"], ["Shares tradable (float)", isNum(x.float_shares) ? big(x.float_shares, "") : "–"],
      ["Held by insiders", pc(x.held_insiders, 1)], ["Held by institutions", pc(x.held_institutions, 1)], ["Short interest (of float)", pc(x.short_pct_float, 1)], ["Days to cover shorts", isNum(x.short_ratio) ? x.short_ratio.toFixed(1) : "–"],
      ["Current / quick ratio", `${isNum(x.current_ratio) ? x.current_ratio.toFixed(2) : "–"} / ${isNum(x.quick_ratio) ? x.quick_ratio.toFixed(2) : "–"}`], ["Dividend / share (yearly)", isNum(x.div_rate) ? x.div_rate.toFixed(2) : "–"],
    ].filter(([, v]) => v !== "–").map(([a, b]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td></tr>`).join("");
    const legend = ev.metrics.filter((m) => m.help).length ? `<details class="legend"><summary>What do these numbers mean?</summary><dl>${ev.metrics.filter((m) => m.help).map((m) => `<dt>${esc(m.label)}</dt><dd>${esc(m.help)}</dd>`).join("")}</dl></details>` : "";
    return grid + (more ? `<table class="lk-kv"><tbody>${more}</tbody></table>` : "") + legend;
  }

  function financialsBlock(rep, A) {
    const T = A.trends, cur = rep.profile.financial_currency || rep.profile.currency;
    if (!T.annual.length && !T.quarterly.length) return `<p class="muted">No financial statements came back for this symbol${rep.profile.type === "ETF" ? " (funds do not file company statements)" : ""}.</p>`;
    const grid = (rows, label) => {
      if (!rows.length) return "";
      const cols = rows.filter((r) => r.revenue !== null || r.net_income !== null);   // newest first, so the latest period is on screen; empty periods dropped
      if (!cols.length) return "";
      const line = (name, fn, fmt) => tr([name, ...cols.map((r) => { const v = fn(r); return { t: fmt(v), c: fmt === sp ? cls(v) : "" }; })]);
      const m = (v) => big(v, cur);
      return `<h4>${esc(label)} (${esc(cur || "")})</h4>` + table(["", ...cols.map((r) => r.period.slice(0, 7))], [
        line("Revenue", (r) => r.revenue, m), line("Growth vs a year earlier", (r) => r.rev_growth, sp), line("Gross margin", (r) => r.gross_margin, pc), line("Operating margin", (r) => r.op_margin, pc),
        line("Net income", (r) => r.net_income, m), line("Net margin", (r) => r.net_margin, pc), line("EPS (diluted)", (r) => r.eps, (v) => (isNum(v) ? v.toFixed(2) : "–")),
        line("Operating cash flow", (r) => r.operating_cf, m), line("Free cash flow", (r) => r.fcf, m), line("Cash", (r) => r.cash, m), line("Debt", (r) => r.debt, m), line("Equity", (r) => r.equity, m),
      ]);
    };
    return grid(T.annual, "Yearly") + grid(T.quarterly, "Quarterly");
  }

  const PERIOD = { "0q": "This quarter", "+1q": "Next quarter", "0y": "This year", "+1y": "Next year" };
  function analystsBlock(rep, A) {
    const a = A.analysts, tg = rep.analysts.targets, cur = rep.profile.currency, out = [];
    if (a.trend && a.total) {
      const t = a.trend, seg = [["strongBuy", "Strong buy", "up"], ["buy", "Buy", "up"], ["hold", "Hold", ""], ["sell", "Sell", "down"], ["strongSell", "Strong sell", "down"]];
      out.push(`<p>${a.total} analysts: ${seg.map(([k, l]) => `${t[k] || 0} ${l.toLowerCase()}`).join(", ")}${a.buyShare !== null ? ` (${pc(a.buyShare)} rate it buy or better)` : ""}.</p>`);
    }
    if (isNum(tg.mean) || isNum(tg.median)) {
      out.push(`<p>Price targets: low ${px(tg.low, cur)}, average ${px(tg.mean, cur)}, median ${px(tg.median, cur)}, high ${px(tg.high, cur)}${a.upside !== null ? `. The average is ${sp(a.upside, 0)} from today's price` : ""}. Targets are opinions, often wrong, and tend to follow the price.</p>`);
    }
    const est = (rows, label, money) => rows.length ? `<h4>${label}</h4>` + table(["Period", "Average", "Low", "High", "Growth", "Analysts"], rows.map((r) => tr([PERIOD[r.period] || r.period || "", money ? big(r.avg, rep.profile.financial_currency || cur) : isNum(r.avg) ? r.avg.toFixed(2) : "–",
      money ? big(r.low, rep.profile.financial_currency || cur) : isNum(r.low) ? r.low.toFixed(2) : "–", money ? big(r.high, rep.profile.financial_currency || cur) : isNum(r.high) ? r.high.toFixed(2) : "–", { t: sp(r.growth, 0), c: cls(r.growth) }, isNum(r.numberOfAnalysts) ? String(r.numberOfAnalysts) : "–"]))) : "";
    out.push(est(rep.analysts.estimates.eps, "Earnings per share expected", false), est(rep.analysts.estimates.revenue, "Revenue expected", true));
    if (rep.analysts.changes.length) {
      out.push(`<h4>Recent rating changes</h4>` + table(["Date", "Firm", "Rating", "Target"], rep.analysts.changes.slice(0, 8).map((c) => tr([c.date || "", c.firm || "", [c.from && c.from !== c.to ? c.from + " →" : "", c.to || "", c.action ? `(${c.action})` : ""].filter(Boolean).join(" "), isNum(c.target) ? px(c.target, cur) : "–"]))));
    }
    return out.join("") || `<p class="muted">No analyst coverage came back for this symbol.</p>`;
  }

  function earningsBlock(rep, A) {
    const out = [], ev = A.events;
    if (ev.earnings || ev.exDiv) out.push(`<p><b>Coming up:</b> ${[ev.earnings && ev.earnings.text, ev.exDiv && ev.exDiv.text].filter(Boolean).map(esc).join("; ")}.</p>`);
    const rows = A.earnings.rows.filter((r) => isNum(r.actual));
    if (rows.length) {
      out.push(table(["Reported", "Expected", "Actual", "Surprise"], rows.slice(0, 8).map((r) => tr([r.date || "", isNum(r.estimate) ? r.estimate.toFixed(2) : "–", r.actual.toFixed(2), { t: isNum(r.surprise_pct) ? (r.surprise_pct > 0 ? "+" : "") + r.surprise_pct.toFixed(1) + "%" : "–", c: cls(r.surprise_pct) }]))));
      if (A.earnings.last4 >= 2) out.push(`<p class="muted">Beat estimates in ${A.earnings.beats} of the last ${A.earnings.last4} quarters. Beating is common (companies guide analysts low), so what matters is the size of the surprise and how the stock reacts.</p>`);
    }
    return out.join("") || `<p class="muted">No earnings history came back for this symbol.</p>`;
  }

  function dividendsBlock(rep, A) {
    const d = A.dividends, cur = rep.profile.currency;
    if (!d) return `<p class="muted">No dividends in the last five years.</p>`;
    const split = rep.splits.length ? `<p class="muted">Stock splits: ${rep.splits.slice(-4).map(([dd, r]) => `${esc(dd)} (${r >= 1 ? r + "-for-1" : "1-for-" + Math.round(1 / r)})`).join(", ")}.</p>` : "";
    return `<p>Paid ${px(d.ttm, cur)} per share over the last 12 months in ${d.perYear} payment${d.perYear === 1 ? "" : "s"}${d.yield !== null ? ` (a ${pc(d.yield, 2)} yield)` : ""}${d.change !== null ? `, ${sp(d.change, 0)} vs the 12 months before` : ""}.</p>`
      + table(["Paid on", "Per share"], d.last.map(([dd, v]) => tr([dd, px(v, cur)]))) + split;
  }

  function peopleBlock(rep, A) {
    const out = [], ins = A.insiders;
    if (rep.insiders.length) {
      out.push(`<h4>Insider transactions (recent)</h4><p class="muted">${ins.buys} open-market purchase${ins.buys === 1 ? "" : "s"} (${big(ins.buyValue, "USD")}) and ${ins.sells} sale${ins.sells === 1 ? "" : "s"} (${big(ins.sellValue, "USD")}) among the latest ${rep.insiders.length}. Executives sell for many routine reasons (taxes, scheduled plans), so purchases tell you more than sales.</p>`
        + table(["Date", "Who", "What", "Value"], rep.insiders.slice(0, 8).map((t) => tr([t.date || "", [t.insider, t.position].filter(Boolean).join(", "), t.text || "", isNum(t.value) && t.value > 0 ? big(t.value, "USD") : "–"]))));
    }
    if (rep.holders.top.length) {
      out.push(`<h4>Largest institutional holders</h4>` + table(["Holder", "Share of company", "Change"], rep.holders.top.slice(0, 8).map((h) => tr([h.holder || "", pc(h.pct, 2), { t: sp(h.change, 1), c: cls(h.change) }]))));
    }
    return out.join("") || `<p class="muted">No ownership data came back for this symbol.</p>`;
  }

  function newsBlock(rep, A, now) {
    if (!rep.news.length) return `<p class="muted">No recent headlines for this symbol.</p>`;
    const nv = A.news;
    return `<p class="muted">Tone of the latest ${nv.n} headlines: ${esc(nv.word)} (${nv.pos} positive, ${nv.neg} negative), scored by the same keyword method as the rest of the app. It is a rough signal.</p><ul class="news">`
      + rep.news.slice(0, 10).map((n) => `<li><span class="dot ${n.score > 0.15 ? "up" : n.score < -0.15 ? "down" : ""}"></span><span>${link(n.url, n.title)}${n.time ? `<time>${esc(ago(n.time, now))}</time>` : ""}${n.summary ? `<br><span class="muted">${esc(n.summary)}</span>` : ""}</span></li>`).join("") + `</ul>`;
  }

  function aboutBlock(rep) {
    const p = rep.profile, w = p.website && /^https?:\/\//i.test(p.website) ? p.website : null;
    const facts = [p.family ? `Fund family: ${p.family}` : null, p.employees ? `${Math.round(p.employees).toLocaleString("en-US")} employees` : null, p.country, p.currency ? `Trades in ${p.currency}` : null].filter(Boolean);
    return (p.summary ? `<p>${esc(p.summary)}</p>` : `<p class="muted">No description came back.</p>`) + (facts.length ? `<p class="muted">${facts.map(esc).join(" · ")}</p>` : "") + (w ? `<p>${link(w, w.replace(/^https?:\/\//, ""))}</p>` : "");
  }


  /* ---------- options ---------- */
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dmy = (iso) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}${iso.slice(0, 4) !== String(new Date().getUTCFullYear()) ? " " + iso.slice(0, 4) : ""}`;
  const usd = (n) => (isNum(n) ? (n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n)) : "–");
  const int = (n) => (isNum(n) ? Math.round(n).toLocaleString("en-US") : "–");
  const card = (label, value, sub, meaning, extra = "") => `<div class="lk-card"><span class="lk-card-l">${esc(label)}</span><b class="lk-card-v">${value}</b><span class="lk-card-s">${sub}</span>${extra}<p class="lk-card-m">${meaning}</p></div>`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function optionsBlock(rep, A) {
    const o = A.options;
    if (!rep.options) return `<p class="muted">Yahoo lists no options for this symbol. That is normal for many non-US stocks, thinly traded names and some funds.</p>`;
    if (!o) return `<p class="muted">Options data came back but there were no recent trades to analyse.</p>`;
    const cur = rep.profile.currency, h = o.headline, iv = o.iv, pcr = o.pc, un = o.unusual, etf = rep.profile.type === "ETF" || rep.info.type === "ETF";
    const cards = [];

    // 1. expected move
    if (h) {
      const bar = `<div class="lk-range" aria-hidden="true"><span class="lk-band"></span><i class="lk-mark"></i></div><div class="lk-range-l"><span>${esc(px(h.low, cur))}</span><span>now ${esc(px(o.spot, cur))}</span><span>${esc(px(h.high, cur))}</span></div>`;
      cards.push(card("Expected move", `±${pc(h.movePct, 1)}`, `by ${esc(dmy(h.date))} (${Math.round(h.days)} days)`,
        `Options prices imply roughly a 2 in 3 chance the stock finishes between ${esc(px(h.low, cur))} and ${esc(px(h.high, cur))} by then. About 1 time in 3 it ends outside that range, up or down. It is a size of move, not a direction.`, bar));
    } else cards.push(card("Expected move", "–", "not available", "There were no recent trades near today's price to work this out."));

    // 2. implied volatility
    if (iv) {
      const w = iv.ratio === null ? "" : { high: "Options are priced for bigger swings than the stock has recently made: traders are paying up, often ahead of news or because they fear a fall.", low: "Options are priced for smaller swings than the stock has recently made: traders are not paying much for protection.", "in line": "Options are priced in line with how much the stock has actually been moving." }[iv.word];
      cards.push(card("Implied volatility", pc(iv.value, 0) + " a year", iv.realized ? `stock's actual swings, last 3 months: ${pc(iv.realized, 0)}` : "no recent swing figure to compare",
        `How big a yearly swing options traders are pricing in (higher means pricier options). ${esc(w)}`));
    } else cards.push(card("Implied volatility", "–", "not available", "No usable option prices to work it out."));

    // 3. put/call ratio
    if (pcr.volRatio !== null) {
      const pos = clamp(pcr.volRatio / 2, 0, 1) * 100;
      const meter = `<div class="lk-meter" aria-hidden="true"><span class="lk-zone" style="left:${(etf ? 0.7 : 0.45) / 2 * 100}%;width:${((etf ? 1.2 : 0.9) - (etf ? 0.7 : 0.45)) / 2 * 100}%"></span><i style="left:${pos.toFixed(1)}%"></i></div><div class="lk-range-l"><span>more calls</span><span>more puts</span></div>`;
      cards.push(card("Put/call ratio", pcr.volRatio.toFixed(2), `${int(pcr.putVol)} puts vs ${int(pcr.callVol)} calls traded`,
        `${esc(pcr.word.charAt(0).toUpperCase() + pcr.word.slice(1))}. ${etf ? "Funds are often hedged with puts, so 0.7 to 1.2 is normal" : "For most stocks 0.45 to 0.9 is normal, so calls outnumbering puts is usual"}. Compare it with this stock's own usual level: a change matters more than the number.${pcr.thin ? " Very little traded, so treat it as noise." : ""}`, meter));
    } else cards.push(card("Put/call ratio", "–", "no calls traded", "Not enough trading in the latest session."));

    // 4. unusual activity
    cards.push(card("Unusual activity", un.total ? `${un.total} contract${un.total === 1 ? "" : "s"}` : "None", un.total ? `${un.calls} call, ${un.puts} put` : "nothing stands out",
      un.total ? `Contracts where one day's trading was at least as big as everything already open on them, so many new positions were opened. It does not say whether people were buying or selling, or why.` : `No contract traded at least as many as were already open (with $${(50000).toLocaleString("en-US")}+ changing hands).`));

    // plain-words summary
    const says = [];
    if (h) says.push(`Options traders are pricing in a move of about <b>±${pc(h.movePct, 1)}</b> over the next ${Math.round(h.days)} days.`);
    if (o.earnings && o.earnings.jumpPct !== null) says.push(`Around the earnings date (${esc(dmy(o.earnings.date))}) they seem to expect an extra jump of roughly <b>±${pc(o.earnings.jumpPct, 0)}</b> in a day (a rough estimate).`);
    else if (o.earnings) says.push(`Earnings are due around ${esc(dmy(o.earnings.date))}, and the expiry just after it (${esc(dmy(o.earnings.expiry))}) prices a move of about ±${pc(o.earnings.totalMovePct, 0)} up to that date.`);
    if (iv && iv.ratio !== null && iv.word !== "in line") says.push(`Options are <b>${iv.word === "high" ? "expensive" : "cheap"}</b> compared with the stock's recent swings (${pc(iv.value, 0)} vs ${pc(iv.realized, 0)}).`);
    if (iv && iv.term === "inverted") says.push(`Near-term options cost more than later ones (${pc(iv.near, 0)} vs ${pc(iv.far, 0)}): the market is nervous about something soon.`);
    if (o.skew && o.skew.word === "puts pricier") says.push(`Downside protection costs more than upside bets (a put ${pc(1 - o.skew.putStrike / o.spot, 0)} below the price is priced about ${(o.skew.value * 100).toFixed(0)} points higher in volatility than a call ${pc(o.skew.callStrike / o.spot - 1, 0)} above). That is normal for stocks and funds, and bigger values mean more worry about falls.`);
    else if (o.skew && o.skew.word === "calls pricier") says.push(`Upside bets cost more than downside protection, which is unusual and often shows up in hyped stocks.`);
    if (pcr.volRatio !== null && !pcr.thin) says.push(`Call buyers and sellers cannot be told apart in this data, so heavy call trading is <b>not</b> proof that traders expect a rise.`);

    // tables
    const exp = o.expiries.filter((r) => r.iv).slice(0, 10);
    const expTable = exp.length ? `<h4>Expected move by expiry</h4>` + table(["Expiry", "Days", "Move ±", "Range", "Volatility"], exp.map((r) => tr([dmy(r.date) + (r.earnings ? " ★" : ""), String(Math.round(r.days)), pc(r.movePct, 1), `${px(r.low, cur)} – ${px(r.high, cur)}`, pc(r.iv, 0)])))
      + (exp.some((r) => r.earnings) ? `<p class="muted">★ the expiry is after the next earnings date, so its move includes the earnings reaction.</p>` : "") : "";
    const unTable = un.rows.length ? `<h4>Largest unusual trades</h4>` + table(["Contract", "Traded", "Already open", "Money", "How far out"], un.rows.map((u) => tr([`${u.type === "call" ? "Call" : "Put"} ${px(u.strike, cur)} · ${dmy(u.expiry)}`, int(u.vol), int(u.oi), usd(u.premium),
      (u.otmPct > 0 ? pc(u.otmPct, 0) + " out of the money" : u.otmPct < -0.005 ? pc(-u.otmPct, 0) + " in the money" : "at the money") + (u.lottery ? " · lottery-ticket style" : "")])))
      + `<p class="muted">A call pays off if the stock rises past its strike; a put pays off if it falls below. "Money" is volume × last price × 100 shares: an estimate of what changed hands. ${un.total > un.rows.length ? `${un.total - un.rows.length} smaller ones not shown. ` : ""}Each trade has a buyer and a seller, so this cannot show which side was the aggressor.</p>` : "";
    const wallRows = (side, label) => o.walls[side].top.map((w) => tr([`${label} ${px(w.strike, cur)}`, int(w.oi), pc(w.share, 0), (w.distPct >= 0 ? "+" : "") + pc(w.distPct, 1)]));
    const walls = (o.walls.calls.top.length || o.walls.puts.top.length) ? `<h4>Where the most contracts are open (next 60 days)</h4>` + table(["Strike", "Open contracts", "Share", "From price"], [...wallRows("calls", "Call"), ...wallRows("puts", "Put")])
      + `<p class="muted">Strikes with the most contracts open. Prices sometimes gravitate toward them near expiry because of hedging by dealers; this is a tendency, not a rule.</p>` : "";
    const money = pcr.callPremium + pcr.putPremium > 0 ? `<p>Money changing hands in the latest session (rough): <b>${usd(pcr.callPremium)}</b> in calls, <b>${usd(pcr.putPremium)}</b> in puts, across ${pcr.expiries} expiries. Open contracts: ${int(pcr.callOI)} calls and ${int(pcr.putOI)} puts${pcr.oiRatio ? ` (put/call ${pcr.oiRatio.toFixed(2)})` : ""}.</p>` : "";

    const how = `<details class="legend"><summary>How to read options, and what this cannot tell you</summary><dl>
      <dt>Call and put</dt><dd>A call gains if the stock rises; a put gains if it falls. Whoever buys one, someone else sells it.</dd>
      <dt>Expected move</dt><dd>Taken from option prices (the price of an option rises with the swings traders expect). Roughly 2 in 3 outcomes land inside the range. Real moves can be bigger.</dd>
      <dt>Implied volatility</dt><dd>The yearly swing size built into option prices. It usually sits a bit above actual swings, because people pay for protection. It jumps before earnings and in scary markets.</dd>
      <dt>Put/call ratio</dt><dd>Puts traded divided by calls traded. Many puts can be hedges by people who own the stock, and many calls can be covered-call sellers. It is a mood gauge, not a forecast.</dd>
      <dt>Unusual activity</dt><dd>Volume bigger than the contracts already open. It flags where attention is, but buyer versus seller is unknown, so the direction is unknown too.</dd>
      <dt>Can big call buying predict a rise?</dt><dd>Not reliably. Studies find small, short-lived signals at best, and only when the trades are known to be opening buys, which this free data does not show.</dd></dl></details>`;

    const how2 = `<p class="muted">Estimated by this page from option prices (${o.quotesLive ? "live quotes" : "last traded prices from " + esc(dmy(o.session))}), with a 4% interest rate and no dividends, so small differences from a broker's figures are normal. Research information, not advice.</p>`;
    const notes = o.notes.length ? `<ul class="lk-notes">${o.notes.map((n) => `<li class="muted">${esc(n)}</li>`).join("")}</ul>` : "";
    return `<div class="lk-cards">${cards.join("")}</div>${says.length ? `<h4>In plain words</h4><ul class="lk-list">${says.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}${notes}${expTable}${unTable}${walls}${money}${how}${how2}`;
  }

  /* rep: sanitised report (found); A: analysis. Returns HTML. */
  function reportHtml(rep, A, now = Date.now()) {
    const etf = rep.profile.type === "ETF" || rep.info.type === "ETF";
    const missing = Object.keys(rep.errors || {});
    const stamp = `<p class="muted">Fetched ${esc(rep.fetched || "")} from Yahoo Finance${missing.length ? `. Not available for this symbol: ${missing.map(esc).join(", ")}` : ""}. Yahoo's data can be wrong or delayed.</p>`;
    return header(rep, A, now) + sec("Points in its favour and of caution", checksBlock(A)) + sec("Price and momentum", priceBlock(rep, A)) + sec("Options: what traders are pricing in", optionsBlock(rep, A))
      + sec(etf ? "Fund numbers" : "Key numbers", metricsBlock(rep, A)) + (etf ? "" : sec("Financial statements", financialsBlock(rep, A), false) + sec("Analysts", analystsBlock(rep, A), false) + sec("Earnings", earningsBlock(rep, A), false))
      + sec("Dividends", dividendsBlock(rep, A), false) + (etf ? "" : sec("Insiders and big holders", peopleBlock(rep, A), false)) + sec("News", newsBlock(rep, A, now), false) + sec("About", aboutBlock(rep), false) + stamp
      + `<p class="muted">Research tool, not financial advice. Do your own research before acting on any idea.</p>`;
  }

  const api = { reportHtml, big, px };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LookupView = api;
})(typeof self !== "undefined" ? self : this);
