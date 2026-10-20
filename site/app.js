"use strict";
(function () {
  const E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let data, dates, series, feats, benchSeries;
  const state = { universe: new Set(), topN: 5, cost: 10, tab: "rank", ticker: null, horizon: "long" };
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
    for (const t of ["rank", "chart", "bt", "about"]) $(`tab-${t}`).hidden = t !== state.tab;

    const tooFew = state.universe.size < 6;
    $("warn").hidden = !tooFew;
    if (tooFew) {
      $("warn").textContent = "Select at least 6 stocks.";
      for (const t of ["rank", "chart", "bt"]) $(`tab-${t}`).hidden = true;
      return;
    }
    if (state.tab === "rank") renderRank();
    if (state.tab === "chart") renderChart();
    if (state.tab === "bt") renderBacktest();
  }

  const num = (v, d = 2) => v.toFixed(d);
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

  function renderRank() {
    const u = universe();
    let res;
    try { res = E.latestTable(u.tickers, u.prices, u.feats, dates.length, state.horizon); }
    catch (err) { $("warn").hidden = false; $("warn").textContent = err.message; return; }
    const asof = new Date(dates[res.asofIndex] + "T00:00:00Z")
      .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    const hz = E.HORIZONS[state.horizon];
    $("rank-title").textContent = `Top ${state.topN} ideas (${hz.label.toLowerCase()}) as of ${asof}`;
    $("picks").innerHTML = res.rows.slice(0, state.topN)
      .map((r) => `<li><b>${r.rank}. ${esc(r.ticker)}</b><span class="why">${esc(E.explain(r, state.horizon))}</span></li>`).join("");

    const head = ["Ticker", "Rank", "Price", "Score", "1 week", "2 weeks", "1 month", "12-1m mom.", "6-1m mom.", "Trend", "Volatility", "From 1y high"];
    const pc = (v) => `<td class="${cls(v)}">${E.pct(v, 1, true)}</td>`;
    const rows = res.rows.map((r) => `<tr><td>${esc(r.ticker)}</td><td>${r.rank}</td><td>${num(r.price)}</td>`
      + `<td>${num(r.score)}</td>${pc(r.ret_5)}${pc(r.ret_10)}${pc(r.ret_21)}${pc(r.mom_12_1)}${pc(r.mom_6_1)}`
      + `<td>${esc(r.trend_label)}</td><td>${E.pct(r.vol_63d, 1)}</td><td>${E.pct(r.drawdown_1y, 1)}</td></tr>`).join("");
    $("rank-table").innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>`;
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

  /* ---------- boot ---------- */

  fetch("data.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`data.json: HTTP ${r.status}`); return r.json(); })
    .then(setup)
    .catch((err) => { $("status").textContent = "Could not load price data: " + err.message; console.error(err); });
})();
