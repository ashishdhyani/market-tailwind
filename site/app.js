"use strict";
(function () {
  const E = window.Engine, F = window.Fundamentals, D = window.Detail, Hd = window.Holdings;
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let data, dates, series, feats, benchSeries, etfSeries, sectorData = null, newsData = null, fundData = null, groupOf = {};
  const openRows = { rank: new Set(), sec: new Set(), picks: new Set(), hold: new Set() };
  const secCache = {};
  let picksCtx = null;
  const state = { universe: new Set(), groups: new Set(), topN: 5, cost: 10, tab: "rank", ticker: null, horizon: "long", newsSector: null, rankAll: false, profitOnly: false, active: new Set(), hiddenLoss: 0 };
  let btCache = null;

  const toArray = (a) => Float64Array.from(a, (v) => (v === null ? NaN : v));

  function setup(d) {
    data = d;
    dates = d.dates;
    series = {}; feats = {};
    for (const t of d.watchlist) { series[t] = toArray(d.prices[t]); feats[t] = E.featuresFor(series[t]); }
    benchSeries = {}; etfSeries = {};
    for (const t of Object.keys(d.benchmarks)) benchSeries[t] = toArray(d.prices[t]);
    for (const g of d.groups) if (g.etf) etfSeries[g.etf] = toArray(d.prices[g.etf]);
    sectorData = E.deriveSectorData(d, (t) => series[t] || etfSeries[t]);   // Sectors view = last ~year of the same prices
    for (const t of Object.keys(d.prices)) d.prices[t] = true;                // raw JSON arrays are no longer needed; keep the key list
    state.groups = new Set(d.groups.map((g) => g.name));
    for (const g of d.groups) for (const t of g.tickers) groupOf[t] = g.name;
    state.profitOnly = lsGet("mt_profit_only") === true;
    $("profit-only").checked = state.profitOnly;
    applyGroups();
    state.ticker = d.watchlist.includes("AAPL") ? "AAPL" : d.watchlist[0];
    loadHoldings();

    $("generated").textContent = d.generated;
    if ($("refresh-time")) $("refresh-time").textContent = d.generated;
    buildChips();
    buildHorizons();
    bindControls();
    bindHoldings();
    bindPlan();
    $("status").hidden = true;
    $("app").hidden = false;
    render();
  }

  /* ---------- controls ---------- */

  // The universe is whole sector groups (11 US sectors + Singapore), not 500 individual buttons.
  function applyGroups() {
    state.universe = new Set(data.groups.filter((g) => state.groups.has(g.name)).flatMap((g) => g.tickers));
    // Optional: hide companies that report a loss (negative ROE or net margin). Uses today's financials, so it is
    // NOT applied to the backtest (that would be look-ahead bias); the backtest always uses state.universe.
    const lossy = state.profitOnly ? [...state.universe].filter((t) => F.isLossMaking(infoOf(t))) : [];
    state.active = new Set([...state.universe].filter((t) => !lossy.includes(t)));
    state.hiddenLoss = lossy.length;
  }
  function buildChips() {
    $("chips").innerHTML = data.groups
      .map((g) => `<button type="button" class="chip" data-g="${esc(g.name)}" aria-pressed="true">${esc(g.name)} <small>${g.tickers.length}</small></button>`).join("");
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
      const g = b.dataset.g;
      state.groups.has(g) ? state.groups.delete(g) : state.groups.add(g);
      applyGroups();
      b.setAttribute("aria-pressed", state.groups.has(g));
      render();
    });
    const setAll = (on) => {
      state.groups = new Set(on ? data.groups.map((g) => g.name) : []);
      applyGroups();
      document.querySelectorAll("#chips .chip").forEach((c) => c.setAttribute("aria-pressed", on));
      render();
    };
    $("rank-more").onclick = () => { state.rankAll = !state.rankAll; renderRank(); };
    $("profit-only").onchange = (e) => {
      state.profitOnly = e.target.checked;
      lsSet("mt_profit_only", state.profitOnly);
      applyGroups();
      state.rankAll = false;
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
      const more = e.target.closest("[data-more]");
      if (more) {
        const wrap = more.previousElementSibling, on = wrap.classList.toggle("show-all");
        const n = wrap.querySelectorAll("tr.row").length - 1;
        more.textContent = on ? "Show only the top 10" : `Show all ${n} stocks in ${wrap.querySelector("table").dataset.sector}`;
        return;
      }
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
  function universe(forBacktest) {
    const set = forBacktest ? state.universe : state.active;
    const tickers = data.watchlist.filter((t) => set.has(t));
    return { tickers, prices: tickers.map((t) => series[t]), feats: tickers.map((t) => feats[t]) };
  }

  /* ---------- rendering ---------- */

  function render() {
    $("topn-val").textContent = state.topN;
    $("cost-val").textContent = state.cost;
    $("uni-count").textContent = `${state.active.size} of ${data.watchlist.length} stocks` + (state.hiddenLoss ? ` (hiding ${state.hiddenLoss} that report a loss)` : "");
    $("ctl-summary").textContent = `top ${state.topN} · ${state.cost} bps · ${state.active.size} stocks` + (state.profitOnly ? " · no loss-makers" : "");
    const hz = E.HORIZONS[state.horizon];
    document.querySelectorAll("#horizons button").forEach((b) => b.setAttribute("aria-checked", b.dataset.h === state.horizon));
    $("horizon-blurb").textContent = `Ranking by ${hz.blurb}, plus trend, volatility and closeness to the 1-year high.`;

    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    for (const t of ["rank", "sectors", "news", "hold", "chart", "bt", "about"]) $(`tab-${t}`).hidden = t !== state.tab;

    // Sectors and About do not depend on the watchlist selection.
    const tooFew = (state.tab === "bt" ? state.universe.size : state.active.size) < 6 && ["rank", "chart", "bt"].includes(state.tab);
    $("warn").hidden = !tooFew;
    if (tooFew) {
      $("warn").textContent = "Select at least 6 stocks.";
      $(`tab-${state.tab}`).hidden = true;
      return;
    }
    if (state.tab === "sectors") renderSectors();
    if (state.tab === "news") renderNews();
    if (state.tab === "hold") renderHoldings();
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
  // ⚠ next to a stock that reports a loss (negative ROE or net margin), with the numbers on hover / tap.
  const lossFlag = (t) => { const l = F.lossInfo(infoOf(t)); return l ? ` <span class="flag" title="${esc(l.text)}">⚠</span>` : ""; };
  const lossLine = (t) => { const l = F.lossInfo(infoOf(t)); return l ? `<span class="flag-line">⚠ ${esc(l.text)}</span>` : ""; };
  const etfTag = (t) => (infoOf(t)?.type === "ETF" ? ' <span class="tag">ETF</span>' : "");
  const nameTag = (t) => { const n = shortName(t); return n ? `<small class="nm">${esc(n)}</small>` : ""; };

  // The loss-filtered view of the sector data (cached); `raw` (holdings) always sees every stock.
  let sectorDataProfit = null;
  function sectorDataFor(raw) {
    if (raw || !state.profitOnly) return sectorData;
    return (sectorDataProfit ??= { ...sectorData, sectors: Object.fromEntries(Object.entries(sectorData.sectors).map(([k, v]) =>
      [k, { etf: v.etf, stocks: v.stocks.filter((t) => !F.isLossMaking(infoOf(t))) }])) });
  }
  function sectorResult(raw) {  // memoised per horizon and filter; null when sector data is missing
    if (!sectorData) return null;
    const key = `${state.horizon}|${raw ? "raw" : state.profitOnly ? "profit" : "all"}`;
    return (secCache[key] ??= E.sectorAnalysis(sectorDataFor(raw), newsData, state.horizon));
  }

  function tickerNews(t, z) {
    if (!newsData) return null;
    const gen = Date.parse(newsData.generated.replace(" UTC", "Z").replace(" ", "T"));
    const st = E.newsStats(newsData.items, new Set([t]), Number.isNaN(gen) ? Date.now() : gen);
    st.items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    return { n: st.n, avg: st.avg, z, items: st.items };
  }

  function sectorContext(t, raw) {
    const res = sectorResult(raw);
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
    d.className = "detail-row" + (tr.classList.contains("extra") ? " extra" : "");
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
  const rowAttrs = (t, extra) => `class="row${extra ? " extra" : ""}" data-t="${esc(t)}" tabindex="0" aria-expanded="false"`;

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
        + `<span class="st-head"><b>${r.rank}. ${esc(r.ticker)}</b>${etfTag(r.ticker)}${nameTag(r.ticker)}</span>`
        + `<span class="why">${esc(E.explain(r, state.horizon))}</span>`
        + (brief ? `<span class="brief">${esc(brief)}</span>` : "") + lossLine(r.ticker) + `<span class="more">Tap for details</span></summary>`
        + `<div class="detail">${openRows.picks.has(r.ticker) ? detailFor(r.ticker, "rank", r, { n: r.rank, of: total }) : ""}</div></details></li>`;
    }).join("");
    picksCtx = { byTicker, total };

    const head = ["Stock", "Rank", "Price", "Fwd P/E", "Score", "1 week", "2 weeks", "1 month", "3 months", "6 months", "12-1m mom.", "6-1m mom.", "Trend", "Volatility", "From 1y high"];
    const pc = (v) => `<td class="${cls(v)}">${E.pct(v, 1, true)}</td>`;
    const fpe = (t) => { const v = infoOf(t)?.fwd_pe; return v > 0 ? v.toFixed(1) : "–"; };
    const shown = state.rankAll ? res.rows : res.rows.slice(0, 50);
    $("rank-more").hidden = res.rows.length <= 50;
    $("rank-more").textContent = state.rankAll ? "Show only the top 50" : `Show all ${res.rows.length} stocks`;
    const rows = shown.map((r) => `<tr ${rowAttrs(r.ticker)}><td><span class="chev">▸</span><b>${esc(r.ticker)}</b>${etfTag(r.ticker)}${lossFlag(r.ticker)}${nameTag(r.ticker)}</td><td>${r.rank}</td><td>${num(r.price)}</td>`
      + `<td>${fpe(r.ticker)}</td><td>${num(r.score)}</td>${pc(r.ret_5)}${pc(r.ret_10)}${pc(r.ret_21)}${pc(r.ret_63)}${pc(r.ret_126)}${pc(r.mom_12_1)}${pc(r.mom_6_1)}`
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
    const gsel = data.groups.filter((g) => state.groups.has(g.name))
      .map((g) => ({ ...g, tickers: g.tickers.filter((t) => state.active.has(t)) })).filter((g) => g.tickers.length);
    const opts = gsel.flatMap((g) => g.tickers);
    if (!opts.includes(state.ticker)) state.ticker = opts[0];
    sel.innerHTML = gsel.map((g) => `<optgroup label="${esc(g.name)}">${g.tickers.map((t) =>
      `<option value="${esc(t)}" ${t === state.ticker ? "selected" : ""}>${esc(t)}${shortName(t) ? " · " + esc(shortName(t)) : ""}</option>`).join("")}</optgroup>`).join("");

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
    const u = universe(true);   // the loss-making filter never applies to the backtest (look-ahead bias)
    const key = [...u.tickers, state.topN, state.cost, state.horizon].join("|");
    if (!btCache || btCache.key !== key) {
      btCache = { key, res: E.runBacktest(dates, u.prices, u.feats, benchSeries, state.topN, state.cost, 1, state.horizon) };
    }
    const res = btCache.res;
    const hz = E.HORIZONS[state.horizon];
    const cadence = { month: "monthly", "2week": "every 2 weeks", week: "weekly" }[hz.rebalance];
    const pickedOn = data.groups.filter((g) => g.picked && state.groups.has(g.name));
    $("bt-desc").textContent = `Picks ranked by ${hz.blurb}, rebalanced ${cadence}.`
      + (state.profitOnly ? " The “hide companies that report a loss” switch does not apply here: it uses today's financials, and applying them to the past would be look-ahead bias." : "")
      + (pickedOn.length ? ` Includes hand-picked groups (${pickedOn.map((g) => g.name).join(", ")}): they were chosen with hindsight, so results can look better than a real investor could have achieved. Untick them in Controls for a cleaner test.` : "");
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
  const horizonRetKey = () => (E.HORIZONS[state.horizon].days ? `ret_${E.HORIZONS[state.horizon].days}` : "ret_21");
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
    const res = sectorResult();   // honours the 'hide companies that report a loss' switch
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
      + picks.map((r) => `<span class="idea">${esc(r.ticker)}${lossFlag(r.ticker)}<small>${esc(shortName(r.ticker))}</small><small class="${cls(r[rk])}">${retTxt(r[rk])}</small></span>`).join("") + `</div>`
      + `<p class="note">Tap a stock below to see why it is suggested and its key numbers.</p></div>`;

    $("sector-list").innerHTML = res.sectors.map((s) => {
      const fpe = (t) => { const v = infoOf(t)?.fwd_pe; return v > 0 ? v.toFixed(1) : "–"; };
      const rows = s.stocks.map((r, i) => `<tr ${rowAttrs(r.ticker, i >= 10)}><td><span class="chev">▸</span><b>${esc(r.ticker)}</b>${lossFlag(r.ticker)}${i < 3 ? '<span class="tag sug">suggested</span>' : ""}${nameTag(r.ticker)}</td><td>${num(r.price)}</td>`
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
        + (s.stocks.length > 10 ? `<button type="button" class="link" data-more="1">Show all ${s.stocks.length} stocks in ${esc(s.name)}</button>` : "")
        + (res.hasNews ? `<h3>Latest headlines</h3>${newsList(s.headlines, 6)}<button type="button" class="link" data-news="${esc(s.name)}">Read all ${esc(s.name)} news in the News tab →</button>` : "") + `</div></details>`;
    }).join("");
    document.querySelectorAll("#sector-list table").forEach((tb) => wireExpandable(tb, openRows.sec, (t) => detailFor(t, "sector")));
  }

  /* ---------- my holdings (kept only in this browser) ---------- */

  const HOLD_KEY = "mt_holdings", SNAP_KEY = "mt_snap_", SEEN_KEY = "mt_seen_";
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
  let holdings = [];            // [{ t, qty, cost }]
  const sFeats = {}, rankCache = {};
  // Yahoo's sector names -> the names used in the Sectors tab, so a stock and its sector ETF land in one bucket.
  const YAHOO_SECTOR = { Healthcare: "Health Care", "Financial Services": "Financials", "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Defensive": "Consumer Staples", "Basic Materials": "Materials" };

  function loadHoldings() {
    const raw = lsGet(HOLD_KEY);
    holdings = Array.isArray(raw)
      ? raw.filter((h) => h && typeof h.t === "string" && /^[A-Z][A-Z0-9.\-]{0,11}$/.test(h.t))
        .map((h) => ({ t: h.t, qty: Number.isFinite(h.qty) ? h.qty : null, cost: Number.isFinite(h.cost) ? h.cost : null })).slice(0, Hd.MAX_HOLDINGS)
      : [];
  }
  const knownTickers = () => new Set([...Object.keys(data.prices), ...(sectorData ? Object.keys(sectorData.prices) : [])]);

  // Where the app has prices for a ticker: the long watchlist history first, then benchmarks, then sector data.
  function priceSource(t) {
    if (series[t]) return { p: series[t], f: feats[t], n: dates.length };
    if (benchSeries[t]) return { p: benchSeries[t], f: (sFeats[t] ??= E.featuresFor(benchSeries[t])), n: dates.length };
    if (sectorData && sectorData.prices[t]) return { p: sectorData.prices[t], f: (sFeats[t] ??= E.featuresFor(sectorData.prices[t])), n: sectorData.dates.length };
    return null;
  }
  function rowFromSource(src) {
    let i = src.n - 1;
    while (i >= 0 && Number.isNaN(src.p[i])) i--;
    if (i < 0) return null;
    const f = src.f, tr = f.trend[i];
    return { price: src.p[i], mom_12_1: f.mom_12_1[i], mom_6_1: f.mom_6_1[i], ret_5: f.ret_5[i], ret_10: f.ret_10[i], ret_21: f.ret_21[i], ret_63: f.ret_63[i], ret_126: f.ret_126[i],
      trend: tr, trend_label: E.TREND_LABEL[tr] || "n/a", vol_63d: f.vol_63d[i], drawdown_1y: f.drawdown_1y[i] };
  }
  function watchlistRanks() {
    return (rankCache[state.horizon] ??= (() => {
      try {
        const res = E.latestTable(data.watchlist, data.watchlist.map((t) => series[t]), data.watchlist.map((t) => feats[t]), dates.length, state.horizon);
        return { total: res.rows.length, map: new Map(res.rows.map((r) => [r.ticker, r])) };
      } catch { return { total: 0, map: new Map() }; }
    })());
  }

  function signalFor(h) {
    const t = h.t, info = infoOf(t), src = priceSource(t), row = src ? rowFromSource(src) : null;
    const sc = sectorContext(t, true), wr = watchlistRanks(), wrow = wr.map.get(t) || null;
    const z = sc.stock ? sc.stock.newsZ : sc.s && sc.s.etf === t ? sc.s.newsZ : null;
    const news = tickerNews(t, z);
    const ev = info && row ? F.evaluate(info, row.price) : null;
    return { t, h, info, row, sc, wrow, rank: wrow ? { n: wrow.rank, of: wr.total } : null, news,
      newsWord: news && news.n ? D.toneWord(news) : null,
      fund: ev && ev.summary && ev.summary.label !== "Not enough data" ? ev.summary.label : null,
      currency: info?.currency || (t.endsWith(".SI") ? "SGD" : "USD"), covered: !!row,
      group: sc.s ? sc.s.name : info?.type === "ETF" ? groupOf[t] || info.category || "Other ETFs" : YAHOO_SECTOR[info?.sector] || info?.sector || "Other" };
  }

  function holdingDetail(t) {
    const s = signalFor(holdings.find((h) => h.t === t));
    const row = s.row ? (s.wrow ? { ...s.row, score: s.wrow.score } : s.row) : null;
    return D.buildDetail({ ticker: t, info: s.info, price: row ? row.price : null, row, horizon: state.horizon, mode: "holding",
      rank: s.wrow ? s.rank : undefined, sector: s.sc.sector, news: s.news, now: Date.now() });
  }

  const money = (v, c) => (c === "SGD" ? "S$" : "$") + Math.round(v).toLocaleString("en-US");
  const hmsg = (text, err) => { const el = $("hold-msg"); el.textContent = text; el.style.color = err ? "var(--neg)" : ""; };

  function saveFromText(text) {
    const r = Hd.parseHoldings(text, knownTickers());
    holdings = r.holdings;
    const ok = lsSet(HOLD_KEY, holdings);
    $("hold-text").value = holdings.length ? Hd.toCsv(holdings) : "";
    const skipped = r.rejected.length ? ` Skipped ${r.rejected.length} invalid line${r.rejected.length === 1 ? "" : "s"} (${r.rejected.slice(0, 3).map((x) => `"${x.line.slice(0, 24)}": ${x.reason}`).join("; ")}).` : "";
    hmsg(ok ? `Saved ${holdings.length} holding${holdings.length === 1 ? "" : "s"} in this browser.${skipped}` : "Could not save in this browser (private mode?). Your holdings will be lost when you close the tab." + skipped, !ok || (!holdings.length && !!text.trim()));
    render();
  }

  function bindHoldings() {
    $("hold-save").onclick = () => saveFromText($("hold-text").value);
    $("hold-file").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) { hmsg("PDF files cannot be read here. Export your holdings as CSV from your broker, or paste the rows above.", true); return; }
      if (f.size > 1e6) { hmsg("That file is too large for a holdings list.", true); return; }
      const text = await f.text();
      $("hold-text").value = text;
      saveFromText(text);
    };
    $("hold-export").onclick = () => {
      if (!holdings.length) { hmsg("Nothing to export yet.", true); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([Hd.toCsv(holdings)], { type: "text/csv" }));
      a.download = "market-tailwind-holdings.csv";
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("hold-clear").onclick = () => {
      if (!holdings.length || !confirm("Remove all holdings and change history from this browser?")) return;
      holdings = []; lsDel(HOLD_KEY);
      for (const h of Object.keys(E.HORIZONS)) { lsDel(SNAP_KEY + h); lsDel(SEEN_KEY + h); }
      $("hold-text").value = ""; hmsg("All holdings removed from this browser.");
      render();
    };
    $("hold-text").value = holdings.length ? Hd.toCsv(holdings) : "";
  }

  /* ---------- cash planner: you pick the basket, this does the arithmetic ---------- */

  const PLAN_KEY = "mt_plan";
  const $v = (id) => $(id).value;
  function savePlan() {
    lsSet(PLAN_KEY, { cash: $v("plan-cash"), cur: $v("plan-cur"), reserve: $v("plan-reserve"), fee: $v("plan-fee"), frac: $("plan-frac").checked, basket: $v("plan-basket") });
  }
  function restorePlan() {
    const p = lsGet(PLAN_KEY);
    if (!p) return;
    $("plan-cash").value = p.cash ?? ""; $("plan-cur").value = p.cur === "SGD" ? "SGD" : "USD"; $("plan-reserve").value = p.reserve ?? 0;
    $("plan-fee").value = p.fee ?? 0; $("plan-frac").checked = !!p.frac; $("plan-basket").value = typeof p.basket === "string" ? p.basket.slice(0, 5000) : "";
  }

  function calcPlan() {
    const out = $("plan-out"), msg = $("plan-msg");
    out.innerHTML = ""; msg.textContent = ""; msg.style.color = "";
    savePlan();
    const cur = $v("plan-cur"), cash = parseFloat($v("plan-cash"));
    const pb = Hd.parseBasket($v("plan-basket"), knownTickers());
    const items = [], notes = pb.rejected.map((x) => `Skipped "${x.line.slice(0, 24)}": ${x.reason}`);
    for (const it of pb.items) {
      const sig = signalFor({ t: it.t });
      if (!sig.covered) { notes.push(`${it.t}: no price data in this app, so it was left out.`); continue; }
      if (sig.currency !== cur) { notes.push(`${it.t} trades in ${sig.currency}, not ${cur}. There is no currency conversion, so it was left out.`); continue; }
      items.push({ t: it.t, price: sig.row.price, weight: it.weight, sig });
    }
    const res = Hd.planBasket({ cash, reservePct: parseFloat($v("plan-reserve")) || 0, fee: parseFloat($v("plan-fee")) || 0, fractional: $("plan-frac").checked, items });
    if (res.error) { msg.textContent = res.error + (notes.length ? " " + notes.join(" ") : ""); msg.style.color = "var(--neg)"; return; }

    const by = new Map(items.map((i) => [i.t, i.sig]));
    const fmtShares = (v) => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2));
    const rows = res.rows.map((r) => {
      const g = by.get(r.t), l = F.lossInfo(g.info);
      const signals = [g.row.trend_label, g.rank ? `#${g.rank.n}/${g.rank.of}` : null, g.newsWord ? `news ${g.newsWord}` : null, g.fund ? `fundamentals ${g.fund.toLowerCase()}` : null]
        .filter(Boolean).map(esc).join(" · ") + (l ? ` <span class="flag" title="${esc(l.text)}">⚠ ${esc(l.short)}</span>` : "");
      return `<tr><td><b>${esc(r.t)}</b>${etfTag(r.t)}${nameTag(r.t)}</td><td>${cur === "SGD" ? "S$" : "$"}${r.price.toFixed(2)}</td><td>${r.weight.toFixed(1)}%</td>`
        + `<td>${fmtShares(r.shares)}</td><td>${esc(money(r.shares * r.price, cur))}</td><td>${r.pctOfCash.toFixed(1)}%</td><td class="sig">${signals}${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ""}</td></tr>`;
    }).join("");
    const T = res.totals;
    const summ = Hd.summarize(res.rows.map((r) => ({ t: r.t, value: r.shares * r.price, currency: cur, group: by.get(r.t).group })))[0];
    const bars = summ ? summ.groups.map((g) => `<div class="bar-row"><span class="bar-label" title="${esc(g.name)}">${esc(g.name)}</span><span class="bar"><i style="width:${(g.weight * 100).toFixed(1)}%"></i></span><span class="bar-val">${(g.weight * 100).toFixed(0)}%</span></div>`).join("") : "";
    const losers = res.rows.filter((r) => F.isLossMaking(by.get(r.t).info)).map((r) => r.t);
    const facts = [
      summ ? `Largest position: <b>${esc(summ.top.t)}</b> at ${(summ.top.weight * 100).toFixed(0)}% of what you invest.` : "",
      losers.length ? `Reports a loss: <b>${losers.map(esc).join(", ")}</b> (see the ⚠ marks).` : "",
      ...res.warnings.map(esc), ...notes.map(esc),
    ].filter(Boolean).map((x) => `<li>${x}</li>`).join("");
    out.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Stock</th><th>Price</th><th>Weight</th><th>Shares</th><th>Amount</th><th>% of cash</th><th>The app's signals</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + `<p class="plan-total"><b>Invested ${esc(money(T.invested, cur))}</b> of ${esc(money(T.cash, cur))}`
      + `${T.fees ? ` (fees ${esc(money(T.fees, cur))})` : ""} · <b>cash left ${esc(money(T.cashLeft, cur))}</b>${T.reserveCash ? ` (including ${esc(money(T.reserveCash, cur))} kept back)` : ""}</p>`
      + (bars ? `<h3 class="plan-h">Split by sector</h3>${bars}` : "") + (facts ? `<ul class="plan-facts">${facts}</ul>` : "")
      + `<p class="note">A calculation from the numbers you entered, not a recommendation. Real orders fill at live prices, which differ from the last close.</p>`;
  }

  function bindPlan() {
    restorePlan();
    $("plan-go").onclick = calcPlan;
    for (const id of ["plan-cash", "plan-cur", "plan-reserve", "plan-fee", "plan-frac", "plan-basket"]) $(id).addEventListener("change", savePlan);
    $("plan-clear").onclick = () => {
      lsDel(PLAN_KEY);
      for (const id of ["plan-cash", "plan-basket"]) $(id).value = "";
      $("plan-reserve").value = 0; $("plan-fee").value = 0; $("plan-frac").checked = false; $("plan-cur").value = "USD";
      $("plan-out").innerHTML = ""; $("plan-msg").textContent = "Cleared.";
    };
  }

  function renderHoldings() {
    const editor = $("hold-editor");
    if (!holdings.length && !editor.dataset.touched) { editor.open = true; editor.dataset.touched = "1"; }
    const sigs = holdings.map(signalFor);
    const covered = sigs.filter((x) => x.covered), uncovered = sigs.filter((x) => !x.covered);

    // --- concentration (weights within each currency)
    const valued = covered.filter((x) => x.h.qty).map((x) => ({ t: x.t, value: x.h.qty * x.row.price, currency: x.currency, group: x.group }));
    const sums = Hd.summarize(valued);
    const weightOf = new Map(sums.flatMap((c) => c.items.map((i) => [i.t, i.weight])));
    $("hold-summary").innerHTML = sums.map((c) => `<div class="cur-block"><h3>${esc(c.currency)} holdings <small>${esc(money(c.total, c.currency))} · ${c.count} position${c.count === 1 ? "" : "s"}</small></h3>`
      + `<p class="note" style="margin:2px 0 6px">Largest position: <b>${esc(c.top.t)}</b> at ${(c.top.weight * 100).toFixed(0)}% of your ${esc(c.currency)} holdings. Split by sector:</p>`
      + c.groups.map((g) => `<div class="bar-row"><span class="bar-label" title="${esc(g.name)}">${esc(g.name)}</span><span class="bar"><i style="width:${(g.weight * 100).toFixed(1)}%"></i></span><span class="bar-val">${(g.weight * 100).toFixed(0)}%</span></div>`).join("") + `</div>`).join("");

    // --- what changed since the previous update (per horizon; baseline only moves on a NEW data update)
    const cur = { asOf: `${data.generated}|${newsData ? newsData.generated : ""}`, items: {} };
    for (const x of covered) cur.items[x.t] = Hd.snapshotEntry({ trend: x.row.trend_label, rank: x.rank, news: x.news ? { word: x.newsWord, n: x.news.n } : null, fund: x.fund, price: x.row.price });
    const rolled = Hd.rollSnapshots(lsGet(SNAP_KEY + state.horizon), lsGet(SEEN_KEY + state.horizon), cur);
    if (holdings.length) { lsSet(SNAP_KEY + state.horizon, rolled.last); lsSet(SEEN_KEY + state.horizon, rolled.seen); }
    const changes = Hd.diffSnapshots(rolled.seen, cur);
    const hz = E.HORIZONS[state.horizon];
    let chHtml = "";
    if (covered.length) {
      if (!rolled.seen) chHtml = `<p class="note">Change tracking starts now. After the next data update (twice a day), this section lists what moved for your holdings: trend, news tone, ranking, fundamentals check, and price moves of 5% or more.</p>`;
      else if (!changes.length) chHtml = `<div class="changes"><h3>What changed</h3><p class="note">No changes in the tracked signals since the previous update (${esc(rolled.seen.asOf.split("|")[0])}).</p></div>`;
      else {
        const by = {};
        for (const c of changes) (by[c.t] ||= []).push(c);
        chHtml = `<div class="changes"><h3>What changed since the previous update <small class="muted">(${esc(rolled.seen.asOf.split("|")[0])})</small></h3>`
          + `<p class="note" style="margin:2px 0">▲ signal improved · ▼ signal weakened. These describe movement in the app's indicators; they are not instructions. Ranking is for the <b>${esc(hz.label.toLowerCase())}</b> horizon.</p><ul>`
          + Object.entries(by).map(([t, cs]) => `<li><b>${esc(t)}</b>${shortName(t) ? ` <span class="muted">${esc(shortName(t))}</span>` : ""}<br>${cs.map((c) => `<span class="${c.dir === "▲" ? "up" : "down"}">${c.dir}</span> ${esc(c.text)}`).join("<br>")}</li>`).join("") + `</ul></div>`;
      }
    }
    $("hold-changes").innerHTML = chHtml;

    // --- table
    const wrap = $("hold-table-wrap");
    wrap.hidden = !covered.length;
    if (covered.length) {
      const head = ["Stock", "Shares", "Value", "Weight", "P/L", "Trend", "1 week", "1 month", "News", "Fundamentals", "Rank"];
      const pc = (v) => (Number.isFinite(v) ? `<td class="${cls(v)}">${E.pct(v, 1, true)}</td>` : "<td>–</td>");
      const rows = covered.map((x) => {
        const r = x.row, h = x.h, val = h.qty ? h.qty * r.price : null, w = weightOf.get(x.t);
        const pl = h.cost ? r.price / h.cost - 1 : null;
        const rank = x.rank ? `#${x.rank.n}/${x.rank.of}` : x.sc.stock ? `#${x.sc.k} in ${esc(x.sc.sector.name)}` : "–";
        return `<tr ${rowAttrs(x.t)}><td><span class="chev">▸</span><b>${esc(x.t)}</b>${etfTag(x.t)}${lossFlag(x.t)}${nameTag(x.t)}</td><td>${h.qty ? h.qty.toLocaleString("en-US") : "–"}</td>`
          + `<td>${val ? esc(money(val, x.currency)) : "–"}</td><td>${w != null ? (w * 100).toFixed(0) + "%" : "–"}</td>${pc(pl)}<td>${esc(r.trend_label)}</td>${pc(r.ret_5)}${pc(r.ret_21)}`
          + `<td>${x.newsWord ? esc(x.newsWord) : "–"}</td><td>${x.fund ? esc(x.fund) : x.info?.type === "ETF" ? "ETF" : "–"}</td><td>${rank}</td></tr>`;
      }).join("");
      const table = $("hold-table");
      table.innerHTML = `<thead><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>`;
      wireExpandable(table, openRows.hold, holdingDetail);
    }

    // --- not covered
    $("hold-uncovered").innerHTML = uncovered.length
      ? `<p class="note"><b>No data here for ${uncovered.map((x) => esc(x.t)).join(", ")}.</b> The app only has prices for the stocks and ETFs it tracks (see the Rankings and Sectors tabs), so these show no signals. Check the spelling, or use the broker's Yahoo Finance symbol (Singapore stocks end in .SI).</p>` : "";
    if (!holdings.length) $("hold-uncovered").innerHTML = `<p class="note">No holdings yet. Open "Add or edit holdings" above, paste rows or load a CSV file, then save.</p>`;

    // --- headlines that mention a holding
    const asOf = newsAsOf(), set = new Set(holdings.map((h) => h.t));
    const items = newsData ? newsData.items.filter((i) => i.tickers.some((t) => set.has(t)) && asOf - Date.parse(i.time) <= E.NEWS_DAYS * 864e5)
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 12) : [];
    $("hold-news-title").hidden = !items.length;
    $("hold-news").innerHTML = items.map((i) => articleHtml(i, { sug: set })).join("");
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

  Promise.all([getJson("data.json"), getJson("news.json", true), getJson("fundamentals.json", true)])
    .then(([d, news, fund]) => {
      if (fund && fund.items) fundData = fund;
      if (news && Array.isArray(news.items)) { newsData = news; $("news-generated").textContent = news.generated; }
      setup(d);
    })
    .catch((err) => { $("status").textContent = "Could not load price data: " + err.message; console.error(err); });
})();
