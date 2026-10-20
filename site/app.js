"use strict";
(function () {
  const E = window.Engine, F = window.Fundamentals, D = window.Detail;
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let data, dates, series, feats, benchSeries, sectorData = null, newsData = null, fundData = null;
  const openRows = { rank: new Set(), sec: new Set(), picks: new Set() };
  const secCache = {};
  let picksCtx = null;
  const state = { universe: new Set(), topN: 5, cost: 10, tab: "rank", ticker: null, horizon: "long", newsSector: null };
  let btCache = null;

  const toArray = (a) => Float64Array.from(a, (v) => (v === null ? NaN : v));

  function setup(d) {
    data = d;
    dates = d.dates;
    series = {}; feats = {};
    for (const t of d.watchlist) { series[t] = toArray(d.prices[t]); feats[t] = E.featuresFor(series[t]); }
    benchSeries = {};
    for (const t of Object.keys(d.benchmarks)) benchSeries[t] = toArray(d.prices[t]);
    state.universe = new Set(d.watchlist);
    state.ticker = d.watchlist[0];

    $("generated").textContent = d.generated;
    if ($("refresh-time")) $("refresh-time").textContent = d.generated;
    buildChips();
    buildHorizons();
    bindControls();
    $("status").hidden = true;
    $("app").hidden = false;
    render();
  }

  /* ---------- controls ---------- */

  function buildChips() {
    $("chips").innerHTML = data.watchlist
      .map((t) => `<button type="button" class="chip" data-t="${esc(t)}" aria-pressed="true">${esc(t)}</button>`).join("");
  }

  function buildHorizons() {
    $("horizons").innerHTML = Object.entries(E.HORIZONS)
      .map(([k, h]) => `<button type="button" role="radio" data-h="${k}" aria-checked="false">${esc(h.label)}</button>`).join("");
    $("horizons").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.horizon = b.dataset.h;
      render();
    });
  }

  function bindControls() {
    $("chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const t = b.dataset.t;
      state.universe.has(t) ? state.universe.delete(t) : state.universe.add(t);
      b.setAttribute("aria-pressed", state.universe.has(t));
      render();
    });
    const setAll = (on) => {
      state.universe = new Set(on ? data.watchlist : []);
      document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", on));
      render();
    };
    $("uni-all").onclick = () => setAll(true);
    $("uni-none").onclick = () => setAll(false);
    $("topn").oninput = (e) => { state.topN = +e.target.value; render(); };
    $("cost").oninput = (e) => { state.cost = +e.target.value; render(); };
    $("ticker").onchange = (e) => { state.ticker = e.target.value; renderChart(); };
    $("sec-chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (b) { state.newsSector = b.dataset.sec; renderNews(); }
    });
    $("sector-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-news]");
      if (b) { state.newsSector = b.dataset.news; state.tab = "news"; render(); window.scrollTo(0, 0); }
    });
    // <details> "toggle" does not bubble, so listen in the capture phase (once, here).
    $("picks").addEventListener("toggle", (e) => {
      const det = e.target;
      if (!picksCtx || !det.matches?.("details.stock")) return;
      const t = det.dataset.t, box = det.querySelector(".detail"), r = picksCtx.byTicker.get(t);
      if (det.open) { openRows.picks.add(t); if (r && !box.firstChild) box.innerHTML = detailFor(t, "rank", r, { n: r.rank, of: picksCtx.total }); }
      else openRows.picks.delete(t);
    }, true);
    document.querySelectorAll(".tabs button").forEach((b) => {
      b.onclick = () => { state.tab = b.dataset.tab; render(); };
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => render());
  }

  // The universe in watchlist order, with its per-ticker arrays.
  function universe() {
    const tickers = data.watchlist.filter((t) => state.universe.has(t));
    return { tickers, prices: tickers.map((t) => series[t]), feats: tickers.map((t) => feats[t]) };
  }

  /* ---------- rendering ---------- */

  function render() {
    $("topn-val").textContent = state.topN;
    $("cost-val").textContent = state.cost;
    $("uni-count").textContent = `${state.universe.size} of ${data.watchlist.length}`;
    $("ctl-summary").textContent = `top ${state.topN} · ${state.cost} bps · ${state.universe.size} stocks`;
    const hz = E.HORIZONS[state.horizon];
    document.querySelectorAll("#horizons button").forEach((b) => b.setAttribute("aria-checked", b.dataset.h === state.horizon));
    $("horizon-blurb").textContent = `Ranking by ${hz.blurb}, plus trend, volatility and closeness to the 1-year high.`;

    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    for (const t of ["rank", "sectors", "news", "chart", "bt", "about"]) $(`tab-${t}`).hidden = t !== state.tab;

    // Sectors and About do not depend on the watchlist selection.
    const tooFew = state.universe.size < 6 && ["rank", "chart", "bt"].includes(state.tab);
    $("warn").hidden = !tooFew;
    if (tooFew) {
      $("warn").textContent = "Select at least 6 stocks.";
      $(`tab-${state.tab}`).hidden = true;
      return;
    }
    if (state.tab === "sectors") renderSectors();
    if (state.tab === "news") renderNews();
    if (state.tab === "rank") renderRank();
    if (state.tab === "chart") renderChart();
    if (state.tab === "bt") renderBacktest();
  }

  const num = (v, d = 2) => v.toFixed(d);
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

  /* ---------- company info & expandable details ---------- */

  const infoOf = (t) => (fundData && fundData.items[t]) || null;
  function shortName(t) {
    const n = infoOf(t)?.name;
    if (!n) return "";
    const s = n.replace(/^State Street /, "").replace(/,? (Inc\.?|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|PLC|plc|N\.V\.|S\.A\.|Holdings?( Ltd\.?| Corporation)?|Group( Holdings?)?|Incorporated)\b\.?/g, "").replace(/\s+/g, " ").trim();
    return s.length > 32 ? s.slice(0, 31) + "…" : s;
  }
  const nameTag = (t) => { const n = shortName(t); return n ? `<small class="nm">${esc(n)}</small>` : ""; };

  function sectorResult() {  // memoised per horizon; null when sector data is missing
    if (!sectorData) return null;
    return (secCache[state.horizon] ??= E.sectorAnalysis(sectorData, newsData, state.horizon));
  }

  function tickerNews(t, z) {
    if (!newsData) return null;
    const gen = Date.parse(newsData.generated.replace(" UTC", "Z").replace(" ", "T"));
    const st = E.newsStats(newsData.items, new Set([t]), Number.isNaN(gen) ? Date.now() : gen);
    st.items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    return { n: st.n, avg: st.avg, z, items: st.items };
  }

  function sectorContext(t) {
    const res = sectorResult();
    if (!res) return { res: null };
    for (const s of res.sectors) {
      const k = s.stocks.findIndex((r) => r.ticker === t);
      if (k >= 0 || s.etf === t) {
        const rk = horizonRetKey();
        return { res, s, stock: k >= 0 ? s.stocks[k] : null, k: k + 1,
          sector: { name: s.name, rank: s.rank, of: res.sectors.length, etf: s.etf, etfRet: s.etfRow[rk], retLabel: horizonRetLabel().toLowerCase(), final: s.final } };
      }
    }
    return { res };
  }

  /* HTML for the inline panel of one ticker. `mode` is where it is shown: "rank" or "sector". */
  function detailFor(t, mode, rankRow, rankInfo) {
    const sc = sectorContext(t);
    let row = rankRow, z = null;
    if (mode === "sector") {
      row = sc.stock ? sc.stock : sc.s ? { ...sc.s.etfRow, final: sc.s.final } : null;
    }
    if (sc.stock) z = sc.stock.newsZ; else if (sc.s && sc.s.etf === t) z = sc.s.newsZ;
    const price = row ? row.price : null;
    return D.buildDetail({
      ticker: t, info: infoOf(t), price, row, horizon: state.horizon, mode, rank: rankInfo, sector: sc.sector,
      stockRank: { k: sc.k, of: sc.s ? sc.s.stocks.length : 0 }, news: tickerNews(t, z), now: Date.now(),
    });
  }

  /* Click a ".row" in a table to open/close a detail row right beneath it. */
  function openDetailRow(table, tr, set) {
    const t = tr.dataset.t, wrap = table.parentElement, cols = tr.children.length;
    const d = document.createElement("tr");
    d.className = "detail-row";
    d.innerHTML = `<td colspan="${cols}"><div class="detail" style="width:${Math.max(240, wrap.clientWidth - 2)}px">${table._build(t)}</div></td>`;
    tr.after(d);
    tr.setAttribute("aria-expanded", "true");
    set.add(t);
  }
  function closeDetailRow(tr, set) {
    if (tr.nextElementSibling?.classList.contains("detail-row")) tr.nextElementSibling.remove();
    tr.setAttribute("aria-expanded", "false");
    set.delete(tr.dataset.t);
  }
  function wireExpandable(table, set, build) {
    table._build = build;
    const toggle = (tr) => (tr.getAttribute("aria-expanded") === "true" ? closeDetailRow(tr, set) : openDetailRow(table, tr, set));
    table.onclick = (e) => { if (e.target.closest("a")) return; const tr = e.target.closest("tr.row"); if (tr) toggle(tr); };
    table.onkeydown = (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr.row")) { e.preventDefault(); toggle(e.target); }
    };
    table.querySelectorAll("tr.row").forEach((tr) => { if (set.has(tr.dataset.t)) openDetailRow(table, tr, set); });
  }
  const rowAttrs = (t) => `class="row" data-t="${esc(t)}" tabindex="0" aria-expanded="false"`;

  function renderRank() {
    const u = universe();
    let res;
    try { res = E.latestTable(u.tickers, u.prices, u.feats, dates.length, state.horizon); }
    catch (err) { $("warn").hidden = false; $("warn").textContent = err.message; return; }
    const asof = new Date(dates[res.asofIndex] + "T00:00:00Z")
      .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    const hz = E.HORIZONS[state.horizon];
    $("rank-title").textContent = `Top ${state.topN} ideas (${hz.label.toLowerCase()}) as of ${asof}`;
    const total = res.rows.length;
    const byTicker = new Map(res.rows.map((r) => [r.ticker, r]));
    $("picks").innerHTML = res.rows.slice(0, state.topN).map((r) => {
      const info = infoOf(r.ticker), brief = F.brief(info);
      return `<li><details class="stock" data-t="${esc(r.ticker)}" ${openRows.picks.has(r.ticker) ? "open" : ""}><summary>`
        + `<span class="st-head"><b>${r.rank}. ${esc(r.ticker)}</b>${nameTag(r.ticker)}</span>`
        + `<span class="why">${esc(E.explain(r, state.horizon))}</span>`
        + (brief ? `<span class="brief">${esc(brief)}</span>` : "") + `<span class="more">Tap for details</span></summary>`
        + `<div class="detail">${openRows.picks.has(r.ticker) ? detailFor(r.ticker, "rank", r, { n: r.rank, of: total }) : ""}</div></details></li>`;
    }).join("");
    picksCtx = { byTicker, total };

    const head = ["Stock", "Rank", "Price", "Fwd P/E", "Score", "1 week", "2 weeks", "1 month", "12-1m mom.", "6-1m mom.", "Trend", "Volatility", "From 1y high"];
    const pc = (v) => `<td class="${cls(v)}">${E.pct(v, 1, true)}</td>`;
    const fpe = (t) => { const v = infoOf(t)?.fwd_pe; return v > 0 ? v.toFixed(1) : "–"; };
    const rows = res.rows.map((r) => `<tr ${rowAttrs(r.ticker)}><td><span class="chev">▸</span><b>${esc(r.ticker)}</b>${nameTag(r.ticker)}</td><td>${r.rank}</td><td>${num(r.price)}</td>`
      + `<td>${fpe(r.ticker)}</td><td>${num(r.score)}</td>${pc(r.ret_5)}${pc(r.ret_10)}${pc(r.ret_21)}${pc(r.mom_12_1)}${pc(r.mom_6_1)}`
      + `<td>${esc(r.trend_label)}</td><td>${E.pct(r.vol_63d, 1)}</td><td>${E.pct(r.drawdown_1y, 1)}</td></tr>`).join("");
    const table = $("rank-table");
    table.innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>`;
    wireExpandable(table, openRows.rank, (t) => detailFor(t, "rank", byTicker.get(t), { n: byTicker.get(t).rank, of: total }));
  }

  function plotLayout(extra) {
    const text = css("--text"), line = css("--line");
    return Object.assign({
      margin: { l: 48, r: 12, t: 10, b: 10 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: text, size: 12 },
      hovermode: "x unified",
      legend: { orientation: "h", y: -0.12 },
      xaxis: { gridcolor: line, automargin: true },
      yaxis: { gridcolor: line, automargin: true },
    }, extra);
  }
  const plotCfg = { responsive: true, displayModeBar: false };

  function renderChart() {
    const sel = $("ticker");
    const opts = data.watchlist.filter((t) => state.universe.has(t));
    if (!opts.includes(state.ticker)) state.ticker = opts[0];
    sel.innerHTML = opts.map((t) => `<option ${t === state.ticker ? "selected" : ""}>${esc(t)}</option>`).join("");

    // Like the Python app: drop gaps first, then take rolling averages on what is left.
    const raw = series[state.ticker], x = [], y = [];
    for (let i = 0; i < raw.length; i++) if (!Number.isNaN(raw[i])) { x.push(dates[i]); y.push(raw[i]); }
    const yArr = Float64Array.from(y);
    const sma = (w) => Array.from(E.rolling(yArr, w, E.mean), (v) => (Number.isNaN(v) ? null : v));
    const cutoff = new Date(Date.parse(x[x.length - 1]) - 730 * 864e5).toISOString().slice(0, 10);
    const from = x.findIndex((d) => d >= cutoff);
    const cut = (a) => a.slice(from);
    const trace = (name, yy, extra) => Object.assign({ x: cut(x), y: cut(yy), name, type: "scatter", mode: "lines", line: { width: 2 } }, extra);
    Plotly.react("price-chart", [
      trace("Price", y), trace("50d avg", sma(50)), trace("200d avg", sma(200)),
    ], plotLayout({}), plotCfg);
  }

  function renderBacktest() {
    const u = universe();
    const key = [...u.tickers, state.topN, state.cost, state.horizon].join("|");
    if (!btCache || btCache.key !== key) {
      btCache = { key, res: E.runBacktest(dates, u.prices, u.feats, benchSeries, state.topN, state.cost, 1, state.horizon) };
    }
    const res = btCache.res;
    const hz = E.HORIZONS[state.horizon];
    const cadence = { month: "monthly", "2week": "every 2 weeks", week: "weekly" }[hz.rebalance];
    $("bt-desc").textContent = `Picks ranked by ${hz.blurb}, rebalanced ${cadence}.`;
    const traces = Object.entries(res.equity).map(([name, eq]) => ({
      x: res.dates, y: Array.from(eq), name, type: "scatter", mode: "lines", line: { width: 2 },
    }));
    Plotly.react("bt-chart", traces, plotLayout({
      yaxis: { type: "log", title: { text: "Growth of 1 (log scale)", font: { size: 11 } }, gridcolor: css("--line"), automargin: true },
    }), plotCfg);

    const cols = [["Total return", (v) => E.pct(v, 1)], ["CAGR", (v) => E.pct(v, 1)], ["Volatility", (v) => E.pct(v, 1)],
      ["Sharpe", (v) => num(v)], ["Max drawdown", (v) => E.pct(v, 1)], ["Annual turnover", (v) => E.pct(v, 0)]];
    const mrows = Object.entries(res.metrics).map(([name, m]) => `<tr><td>${esc(name)}</td>`
      + cols.map(([k, f]) => `<td>${m[k] === undefined || Number.isNaN(m[k]) ? "" : f(m[k])}</td>`).join("") + "</tr>").join("");
    $("bt-metrics").innerHTML = `<thead><tr><th>Series</th>${cols.map(([k]) => `<th>${k}</th>`).join("")}</tr></thead><tbody>${mrows}</tbody>`;

    const names = Object.keys(res.yearly.values);
    const yrows = res.yearly.years.map((yr, i) => `<tr><td>${yr}</td>`
      + names.map((n) => { const v = res.yearly.values[n][i]; return `<td class="${cls(v)}">${E.pct(v, 1)}</td>`; }).join("") + "</tr>").join("");
    $("bt-yearly").innerHTML = `<thead><tr><th>Year</th>${names.map((n) => `<th>${esc(n)}</th>`).join("")}</tr></thead><tbody>${yrows}</tbody>`;
  }

  /* ---------- sectors & news ---------- */

  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");
  const toneWord = (z) => (z > 0.5 ? "better than most" : z < -0.5 ? "weaker than most" : "about average");
  const retTxt = (v) => E.pct(v, 1, true);
  const horizonRetKey = () => ({ 5: "ret_5", 10: "ret_10", 21: "ret_21" }[E.HORIZONS[state.horizon].days] || "ret_21");
  const horizonRetLabel = () => (E.HORIZONS[state.horizon].days ? E.HORIZONS[state.horizon].label : "1 month");

  function ago(iso) {
    const h = (Date.now() - Date.parse(iso)) / 36e5;
    return h < 1 ? "just now" : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
  }

  function newsList(items, max) {
    if (!items.length) return '<p class="note">No recent headlines.</p>';
    return `<ul class="news">${items.slice(0, max).map((it) => {
      const d = it.score > 0.15 ? "up" : it.score < -0.15 ? "down" : "";
      return `<li><span class="dot ${d}" title="tone ${it.score.toFixed(2)}"></span><span><a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>`
        + `<time>${esc(ago(it.time))} · ${esc(it.tickers.slice(0, 4).join(", "))}</time></span></li>`;
    }).join("")}</ul>`;
  }

  function renderSectors() {
    if (!sectorData) {
      $("sector-hero").innerHTML = "";
      $("sector-list").innerHTML = '<p class="notice">Sector data is not available yet. It is created by the daily refresh job.</p>';
      return;
    }
    const res = E.sectorAnalysis(sectorData, newsData, state.horizon);
    const rk = horizonRetKey(), rl = horizonRetLabel();
    $("sector-note").textContent = res.hasNews
      ? `Ranked by ${E.HORIZONS[state.horizon].blurb} of the sector ETF (70%) and news tone over the last 7 days (30%). Prices as of ${res.asOf}.`
      : `No news file found, so sectors are ranked on price alone. Prices as of ${res.asOf}.`;

    const top = res.sectors[0], picks = top.stocks.slice(0, 3);
    const why = `${top.etf} ${retTxt(top.etfRow[rk])} over ${rl.toLowerCase()}, ${top.etfRow.trend_label.toLowerCase()}`
      + (res.hasNews ? `; headline tone ${toneWord(top.newsZ)} (${top.newsN} headlines)` : "");
    $("sector-hero").innerHTML = `<div class="hero"><div class="kicker">Strongest sector right now</div>`
      + `<h2>${esc(top.name)}</h2><p>${esc(why)}.</p>`
      + `<div class="ideas"><span class="idea">${esc(top.etf)}<small>${esc(shortName(top.etf))}</small><small>ETF</small></span>`
      + picks.map((r) => `<span class="idea">${esc(r.ticker)}<small>${esc(shortName(r.ticker))}</small><small class="${cls(r[rk])}">${retTxt(r[rk])}</small></span>`).join("") + `</div>`
      + `<p class="note">Tap a stock below to see why it is suggested and its key numbers.</p></div>`;

    $("sector-list").innerHTML = res.sectors.map((s) => {
      const fpe = (t) => { const v = infoOf(t)?.fwd_pe; return v > 0 ? v.toFixed(1) : "–"; };
      const rows = s.stocks.map((r, i) => `<tr ${rowAttrs(r.ticker)}><td><span class="chev">▸</span><b>${esc(r.ticker)}</b>${i < 3 ? '<span class="tag sug">suggested</span>' : ""}${nameTag(r.ticker)}</td><td>${num(r.price)}</td>`
        + `<td class="${cls(r.ret_5)}">${retTxt(r.ret_5)}</td><td class="${cls(r.ret_21)}">${retTxt(r.ret_21)}</td><td>${fpe(r.ticker)}</td>`
        + `<td>${esc(r.trend_label)}</td><td>${res.hasNews ? esc(toneWord(r.newsZ)) : "n/a"}</td><td>${num(r.final)}</td></tr>`).join("");
      const e = s.etfRow;
      const etfRow = `<tr ${rowAttrs(s.etf)}><td><span class="chev">▸</span><b>${esc(s.etf)}</b><span class="tag">ETF</span>${nameTag(s.etf)}</td><td>${num(e.price)}</td><td class="${cls(e.ret_5)}">${retTxt(e.ret_5)}</td>`
        + `<td class="${cls(e.ret_21)}">${retTxt(e.ret_21)}</td><td>–</td><td>${esc(e.trend_label)}</td><td>${res.hasNews ? esc(toneWord(s.newsZ)) : "n/a"}</td><td>${num(s.final)}</td></tr>`;
      return `<details class="sector" ${s.rank === 1 ? "open" : ""}><summary>`
        + `<span class="s-name">${s.rank}. ${esc(s.name)}<small>${esc(s.etf)}</small></span><span class="s-score">${num(s.final)}</span>`
        + `<span class="s-meta"><span class="${cls(e[rk])}">${retTxt(e[rk])} ${esc(rl.toLowerCase())}</span><span>${esc(e.trend_label)}</span>`
        + (res.hasNews ? `<span>News: ${esc(toneWord(s.newsZ))} · ${s.newsN} headlines</span>` : "") + `</span></summary>`
        + `<div class="body"><h3>Ideas in ${esc(s.name)}</h3><div class="table-wrap"><table data-sector="${esc(s.name)}"><thead><tr><th>Stock</th><th>Price</th><th>1 week</th><th>1 month</th><th>Fwd P/E</th><th>Trend</th><th>News</th><th>Score</th></tr></thead>`
        + `<tbody>${etfRow}${rows}</tbody></table></div>`
        + (res.hasNews ? `<h3>Latest headlines</h3>${newsList(s.headlines, 6)}<button type="button" class="link" data-news="${esc(s.name)}">Read all ${esc(s.name)} news in the News tab →</button>` : "") + `</div></details>`;
    }).join("");
    document.querySelectorAll("#sector-list table").forEach((tb) => wireExpandable(tb, openRows.sec, (t) => detailFor(t, "sector")));
  }

  /* ---------- news tab ---------- */

  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const newsAsOf = () => {
    const g = newsData ? Date.parse(newsData.generated.replace(" UTC", "Z").replace(" ", "T")) : NaN;
    return Number.isNaN(g) ? Date.now() : g;
  };

  /* One headline: tap to read its summary right here. `o`: { impact, lift, sug (Set of suggested tickers) }. */
  function articleHtml(it, o = {}) {
    const d = it.score > 0.15 ? "up" : it.score < -0.15 ? "down" : "";
    const tks = (it.tickers || []).slice(0, 5).map((t) => `<span class="tk${o.sug && o.sug.has(t) ? " sug" : ""}">${esc(t)}</span>`).join("");
    const infl = o.impact != null
      ? `<span class="infl ${o.lift > 0 ? "up" : o.lift < 0 ? "down" : ""}">${o.lift > 0 ? "▲" : o.lift < 0 ? "▼" : "●"} ${(o.impact * 100).toFixed(1)}%</span>` : "";
    const body = it.summary ? `<p>${esc(it.summary)}</p>` : '<p class="muted">No summary available.</p>';
    return `<li><details class="art"><summary><span class="dot ${d}"></span><span class="a-main"><span class="a-title">${esc(it.title)}</span>`
      + `<span class="a-meta">${esc(ago(it.time))}${hostOf(it.url) ? " · " + esc(hostOf(it.url)) : ""} ${tks}</span></span>${infl}</summary>`
      + `<div class="a-body">${body}<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">Read the full article ↗</a></div></details></li>`;
  }

  function renderNews() {
    if (!newsData || !newsData.items.length) {
      $("mkt-mood").textContent = "";
      $("mkt-news").innerHTML = '<li class="notice">No news file yet. It is created by the refresh job.</li>';
      $("sec-chips").innerHTML = ""; $("sec-news").innerHTML = "";
      return;
    }
    const asOf = newsAsOf();

    // --- US market (index feeds): context only
    const market = newsData.items.filter((i) => i.market && asOf - Date.parse(i.time) <= 3 * 864e5)
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    const up = market.filter((i) => i.score > 0.15).length, down = market.filter((i) => i.score < -0.15).length;
    const mood = up > down * 1.5 ? "leaning positive" : down > up * 1.5 ? "leaning negative" : "mixed";
    $("mkt-mood").textContent = market.length
      ? `${market.length} market-wide headlines in the last 3 days: ${up} positive, ${down} negative, ${market.length - up - down} neutral (tone ${mood}). For context only, not part of any score.`
      : "No market-wide headlines found.";
    const first = market.slice(0, 12), rest = market.slice(12, 40);
    $("mkt-news").innerHTML = first.map((i) => articleHtml(i)).join("")
      + (rest.length ? `<li><details class="more-list"><summary>Show ${rest.length} more</summary><ul class="articles">${rest.map((i) => articleHtml(i)).join("")}</ul></details></li>` : "");

    // --- by sector
    const res = sectorResult();
    if (!res) { $("sec-chips").innerHTML = ""; $("sec-news").innerHTML = '<p class="notice">Sector data is not available yet.</p>'; return; }
    const names = res.sectors.map((s) => s.name);
    if (!names.includes(state.newsSector)) state.newsSector = names[0];
    $("sec-chips").innerHTML = res.sectors.map((s) => `<button type="button" class="chip" data-sec="${esc(s.name)}" aria-pressed="${s.name === state.newsSector}">#${s.rank} ${esc(s.name)}</button>`).join("");
    const sec = res.sectors.find((s) => s.name === state.newsSector);
    const set = new Set([sec.etf, ...sectorData.sectors[sec.name].stocks]);
    const rh = E.rankedHeadlines(newsData.items, set, asOf);
    const sug = new Set([sec.etf, ...sec.stocks.slice(0, 3).map((r) => r.ticker)]);
    const top = rh.used.slice(0, 12), more = rh.used.slice(12);
    const li = (u) => articleHtml(u.item, { impact: u.impact, lift: u.lift, sug });
    $("sec-news").innerHTML = `<div class="sec-head"><h3>${esc(sec.name)} <small>${esc(sec.etf)} · ranked #${sec.rank} of ${res.sectors.length}</small></h3>`
      + `<p>News tone is <b>${esc(toneWord(sec.newsZ))}</b> versus other sectors, from <b>${rh.used.length}</b> headlines in the last ${E.NEWS_DAYS} days: `
      + `<span class="pos">${rh.pos} positive</span>, <span class="neg">${rh.neg} negative</span>, ${rh.neutral} neutral. `
      + `Suggested ideas: ${[...sug].map((t) => `<span class="tk sug">${esc(t)}</span>`).join(" ")}.</p>`
      + `<p class="note">Sorted by impact: a headline's share of the sector's tone signal (recent and strongly worded headlines count more). ▲ pushed tone up, ▼ pushed it down. Highlighted tickers are the suggested ideas.</p></div>`
      + (rh.used.length ? `<ul class="articles">${top.map(li).join("")}</ul>` : '<p class="note">No headlines for this sector in the last 7 days.</p>')
      + (more.length ? `<details class="more-list"><summary>Show the other ${more.length} headlines</summary><ul class="articles">${more.map(li).join("")}</ul></details>` : "");
  }

  /* ---------- boot ---------- */

  const getJson = (url, optional) => fetch(url, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); })
    .catch((err) => { if (!optional) throw err; console.warn(err); return null; });

  Promise.all([getJson("data.json"), getJson("sector_data.json", true), getJson("news.json", true), getJson("fundamentals.json", true)])
    .then(([d, sd, news, fund]) => {
      if (fund && fund.items) fundData = fund;
      if (sd) {
        for (const t of Object.keys(sd.prices)) sd.prices[t] = toArray(sd.prices[t]);
        sectorData = sd;
      }
      if (news && Array.isArray(news.items)) { newsData = news; $("news-generated").textContent = news.generated; }
      setup(d);
    })
    .catch((err) => { $("status").textContent = "Could not load price data: " + err.message; console.error(err); });
})();
