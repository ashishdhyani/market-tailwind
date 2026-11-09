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

  /* rep: sanitised report (found); A: analysis. Returns HTML. */
  function reportHtml(rep, A, now = Date.now()) {
    const etf = rep.profile.type === "ETF" || rep.info.type === "ETF";
    const missing = Object.keys(rep.errors || {});
    const stamp = `<p class="muted">Fetched ${esc(rep.fetched || "")} from Yahoo Finance${missing.length ? `. Not available for this symbol: ${missing.map(esc).join(", ")}` : ""}. Yahoo's data can be wrong or delayed.</p>`;
    return header(rep, A, now) + sec("Points in its favour and of caution", checksBlock(A)) + sec("Price and momentum", priceBlock(rep, A))
      + sec(etf ? "Fund numbers" : "Key numbers", metricsBlock(rep, A)) + (etf ? "" : sec("Financial statements", financialsBlock(rep, A), false) + sec("Analysts", analystsBlock(rep, A), false) + sec("Earnings", earningsBlock(rep, A), false))
      + sec("Dividends", dividendsBlock(rep, A), false) + (etf ? "" : sec("Insiders and big holders", peopleBlock(rep, A), false)) + sec("News", newsBlock(rep, A, now), false) + sec("About", aboutBlock(rep), false) + stamp
      + `<p class="muted">Research tool, not financial advice. Do your own research before acting on any idea.</p>`;
  }

  const api = { reportHtml, big, px };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LookupView = api;
})(typeof self !== "undefined" ? self : this);
