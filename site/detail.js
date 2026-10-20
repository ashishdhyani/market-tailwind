/* Builds the expandable "why this stock" panel as an HTML string. Pure (no DOM), so it can be tested in
   Node. Everything that comes from data files is escaped; links are limited to http(s). */
(function (root) {
  "use strict";
  const E = typeof require !== "undefined" ? require("./engine.js") : root.Engine;
  const F = typeof require !== "undefined" ? require("./fundamentals.js") : root.Fundamentals;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");
  const sp = (v, d = 1) => E.pct(v, d, true);
  const TAG = { good: "Good", ok: "Fair", bad: "Weak" };
  const TREND = {
    2: "Strong uptrend: the price is above its 200-day average and the 50-day average is above the 200-day average.",
    1: "Mixed trend: only one of the two trend tests (price vs. 200-day average, 50-day vs. 200-day) is positive.",
    0: "Downtrend: the price is below its 200-day average and the 50-day average is below the 200-day average.",
  };
  const RET_KEY = { 5: "ret_5", 10: "ret_10", 21: "ret_21" };

  function ago(iso, now) {
    const h = (now - Date.parse(iso)) / 36e5;
    return h < 1 ? "just now" : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
  }

  function toneWord(news) {
    if (!news || !news.n) return null;
    if (news.z != null) return news.z > 0.5 ? "better than most" : news.z < -0.5 ? "weaker than most" : "about average";
    return news.avg > 0.3 ? "positive" : news.avg < -0.1 ? "negative" : "neutral";
  }

  /* ctx: { ticker, info, price, row, horizon, mode: "rank"|"sector", rank: {n, of}, sector: {...}, news, now } */
  function buildDetail(ctx) {
    const { ticker, info, row, horizon, mode, now = Date.now() } = ctx;
    const hz = E.HORIZONS[horizon];
    const ev = F.evaluate(info, ctx.price);
    const isEtf = ev && ev.type === "ETF";
    const why = [];

    // 1. Where it ranks
    if (row) {
      if (mode === "sector" && ctx.sector) {
        const s = ctx.sector;
        why.push(isEtf
          ? `<b>${esc(s.name)} is ranked #${s.rank} of ${s.of} sectors</b> (score ${row.final != null ? row.final.toFixed(2) : s.final.toFixed(2)}: 70% price momentum, 30% news tone). This ETF is the simplest way to own the whole sector.`
          : `<b>Ranked #${ctx.stockRank.k} of ${ctx.stockRank.of} in ${esc(s.name)}</b> (score ${row.final.toFixed(2)}: 75% price, 25% news), and ${esc(s.name)} is the #${s.rank} sector of ${s.of}.`);
      } else if (ctx.rank) {
        why.push(`<b>Ranked #${ctx.rank.n} of ${ctx.rank.of}</b> stocks on the ${esc(hz.label.toLowerCase())} horizon (score ${row.score.toFixed(2)}), which blends ${esc(hz.blurb)}, trend, low volatility and closeness to the 1-year high.`);
      }
      // 2. Price evidence
      why.push(hz.days
        ? `<b>Recent strength:</b> return over ${esc(hz.label.toLowerCase())} is ${sp(row[RET_KEY[hz.days]])} (1 week ${sp(row.ret_5)}, 2 weeks ${sp(row.ret_10)}, 1 month ${sp(row.ret_21)}).`
        : `<b>Momentum:</b> ${sp(row.mom_12_1, 0)} over the past year (skipping the latest month) and ${sp(row.mom_6_1, 0)} over six months. Stocks that have been winning tend to keep winning for a while.`);
      why.push(`<b>Trend:</b> ${esc(TREND[row.trend] || row.trend_label)}`);
      why.push(`<b>Risk:</b> price swings about ${E.pct(row.vol_63d, 0)} a year; it is ${row.drawdown_1y > -0.005 ? "at its 1-year high" : E.pct(-row.drawdown_1y, 0) + " below its 1-year high"}.`);
    }

    // 3. Sector context (rank view only; the sector view states it above)
    if (mode === "rank" && ctx.sector) {
      const s = ctx.sector;
      why.push(`<b>Sector:</b> ${esc(s.name)} is the #${s.rank} sector of ${s.of} right now (${esc(s.etf)} ${sp(s.etfRet)} over ${esc(s.retLabel)}).`);
    }

    // 4. News
    const news = ctx.news;
    if (news && news.n) {
      const top = news.items[0];
      why.push(`<b>News:</b> tone is ${esc(toneWord(news))} across ${news.n} headline${news.n === 1 ? "" : "s"} in the last 7 days.`
        + (top ? ` Latest: <a href="${esc(safeUrl(top.url))}" target="_blank" rel="noopener noreferrer">${esc(top.title)}</a> (${esc(ago(top.time, now))}).` : ""));
    } else {
      why.push("<b>News:</b> no recent headlines for this ticker in our feed, so news did not influence it.");
    }

    // 5. Fundamentals
    if (ev && !isEtf) {
      const sm = ev.summary;
      if (sm && sm.label !== "Not enough data") {
        why.push(`<b>Fundamentals check: ${esc(sm.label)}</b> (${sm.good} of ${sm.of} core checks are good). These do <i>not</i> change the ranking; they help you judge whether the price is reasonable.`);
      }
      if (ev.strengths.length) why.push(`<b>Strengths:</b> ${ev.strengths.slice(0, 3).map(esc).join("; ")}.`);
      if (ev.cautions.length) why.push(`<b>Watch out:</b> ${ev.cautions.slice(0, 3).map(esc).join("; ")}.`);
      for (const n of ev.notes) why.push(`<span class="muted">${esc(n)}</span>`);
    } else if (!ev) {
      why.push('<span class="muted">No fundamentals data available for this ticker.</span>');
    }

    // Key numbers grid
    let grid = "";
    if (ev) {
      grid = `<div class="metrics">${ev.metrics.map((m) => `<div class="m ${m.status}" title="${esc(m.help)}">`
        + `<span class="m-label">${esc(m.label)}</span><span class="m-val">${esc(m.text)}</span>`
        + `<span class="m-tag">${m.status === "na" ? "n/a" : TAG[m.status] || ""}</span></div>`).join("")}</div>`;
    }

    // Plain-English legend
    let legend = "";
    if (ev && ev.metrics.length) {
      legend = `<details class="legend"><summary>What do these numbers mean?</summary><dl>`
        + ev.metrics.filter((m) => m.help).map((m) => `<dt>${esc(m.label)}</dt><dd>${esc(m.help)}${m.note ? ` <i>${esc(m.note)}.</i>` : ""}</dd>`).join("")
        + `</dl>` + (isEtf ? "" : `<h4>Whose rules of thumb are these?</h4><ul>${F.GURUS.map((g) => `<li><b>${esc(g.who)}:</b> ${esc(g.idea)} <i>(${esc(g.metrics)})</i></li>`).join("")}</ul>`
          + `<p class="muted">Green/amber/red uses common rules of thumb and varies by sector and market conditions. It is a starting point for research, not a verdict.</p>`) + `</details>`;
    }

    // Headlines
    let heads = "";
    if (news && news.items && news.items.length > 1) {
      heads = `<h4>Recent headlines</h4><ul class="news">${news.items.slice(0, 3).map((it) => {
        const d = it.score > 0.15 ? "up" : it.score < -0.15 ? "down" : "";
        return `<li><span class="dot ${d}"></span><span><a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a><time>${esc(ago(it.time, now))}</time></span></li>`;
      }).join("")}</ul>`;
    }

    const factList = ev ? [ev.name, ...(ev.facts || [])].filter(Boolean) : [];
    const facts = factList.length ? `<p class="facts">${factList.map(esc).join(" · ")}</p>` : "";
    return `<div class="detail-inner">${facts}<h4>Why it is recommended</h4><ul class="why-list">${why.map((w) => `<li>${w}</li>`).join("")}</ul>`
      + (grid ? `<h4>${isEtf ? "Fund numbers" : "Key numbers investors look at"}</h4>${grid}` : "") + legend + heads
      + `<p class="muted">Research tool, not financial advice.</p></div>`;
  }

  const api = { buildDetail, toneWord };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Detail = api;
})(typeof self !== "undefined" ? self : this);
