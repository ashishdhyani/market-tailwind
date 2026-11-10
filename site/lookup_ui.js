/* Lookup tab: the page cannot ask Yahoo for a stock directly (Yahoo blocks web pages), so it asks a GitHub job to fetch
   the report, then reads the saved JSON from the public `lookups` branch. Same GitHub token as the Refresh button
   (kept only in this browser). Recently looked-up symbols are shared (anyone using this site can open them, and can see in
   the repository which symbols were looked up). All the analysis happens in lookup.js and lookup_view.js. */
(function () {
  "use strict";
  const L = window.Lookup, V = window.LookupView, E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const WORKFLOW = "lookup.yml", POLL_MS = 6000, TIMEOUT_MS = 6 * 60 * 1000, RECENT_TTL_MS = 60 * 1000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gh = () => window.GH;

  let host = null, bound = false, busy = false, current = null, recentAt = 0, pending = null;

  const msg = (text, kind) => { const el = $("lk-msg"); el.textContent = text || ""; el.className = "note lk-msg " + (kind || ""); el.hidden = !text; };
  const setBusy = (b) => { busy = b; $("lk-go").disabled = b; $("lk-go").textContent = b ? "Working…" : "Look up"; };
  const showToken = (on) => { $("lk-token-form").hidden = !on; if (on) $("lk-token").focus(); };

  async function getJson(url) {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });   // unique URL: the CDN keeps raw files for minutes otherwise
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const rawBase = () => `https://raw.githubusercontent.com/${gh().OWNER}/${gh().REPO}/lookups`;
  const apiBase = () => `https://api.github.com/repos/${gh().OWNER}/${gh().REPO}/actions`;

  const ageText = (rep, now = Date.now()) => {
    const h = L.ageHours(rep, now);
    return !Number.isFinite(h) ? "at an unknown time" : h < 1 ? (h < 0.03 ? "just now" : `${Math.round(h * 60)} min ago`) : h < 48 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)} days ago`;
  };

  /* ---------- showing a report ---------- */
  function show(raw, opts = {}) {
    const res = L.sanitize(raw);
    if (res.error) { msg(res.error, "err"); return false; }
    const rep = res.report;
    current = rep.symbol;
    const box = $("lk-report");
    if (!rep.found) { box.innerHTML = ""; msg(`${rep.symbol}: ${rep.error}`, "err"); return false; }
    const A = L.analyze(rep, { spy: host.spy(), universe: host.universe(), inApp: host.inApp(rep.symbol), now: Date.now() });
    box.innerHTML = V.reportHtml(rep, A, Date.now());
    drawChart(rep);
    const age = L.isFresh(rep) ? `Saved lookup from ${ageText(rep)}.` : `This saved lookup was fetched ${ageText(rep)}, so prices may have moved since.`;
    msg(`${age}${opts.note ? " " + opts.note : ""}`, L.isFresh(rep) ? "ok" : "");
    const b = document.createElement("button");
    b.type = "button"; b.className = "link"; b.textContent = "Fetch it again now"; b.onclick = () => lookup(rep.symbol, "force");
    $("lk-msg").append(" ", b);
    return true;
  }

  function drawChart(rep) {
    const el = $("lk-chart");
    if (!el || !host.plot) return;
    const x = rep.prices.dates, y = Float64Array.from(rep.prices.close);
    const sma = (w) => Array.from(E.rolling(y, w, E.mean), (v) => (Number.isNaN(v) ? null : v));
    const from = Math.max(0, x.length - 504);                                   // last two years
    const tr = (name, yy, extra) => Object.assign({ x: x.slice(from), y: yy.slice(from), name, type: "scatter", mode: "lines", line: { width: 2 } }, extra);
    host.plot("lk-chart", [tr("Price", Array.from(y)), tr("50d avg", sma(50)), tr("200d avg", sma(200))]);
  }

  /* ---------- recent lookups ---------- */
  async function loadRecent(force) {
    if (!force && Date.now() - recentAt < RECENT_TTL_MS) return;
    recentAt = Date.now();
    let items = [];
    try { const idx = await getJson(`${rawBase()}/index.json`); items = idx && Array.isArray(idx.items) ? idx.items : []; } catch { /* offline or branch not created yet */ }
    const ok = items.filter((i) => i && typeof i.symbol === "string" && L.cleanSymbol(i.symbol) === i.symbol).slice(0, 30);
    $("lk-recent").innerHTML = ok.length
      ? `<p class="muted">Recent lookups (shared, tap to open): ${ok.map((i) => `<button type="button" class="chip lk-chip" data-sym="${esc(i.symbol)}" title="${esc(i.name || "")}${i.found === false ? " (not found)" : ""}">${esc(i.symbol)}</button>`).join(" ")}</p>`
      : "";
  }

  /* ---------- asking GitHub for a fresh report ---------- */
  async function listRuns() {
    const r = await fetch(`${apiBase()}/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).workflow_runs || [];
  }

  async function dispatch(token, symbol) {
    return fetch(`${apiBase()}/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { symbol } }),
    });
  }

  async function fetchFresh(symbol, prevTs) {
    const token = gh().store.get();
    let before = new Set();
    try { before = new Set((await listRuns()).map((r) => r.id)); } catch { /* only used to spot failures */ }
    msg(`Asking GitHub to fetch ${symbol}…`);
    const res = await dispatch(token, symbol);
    if (res.status !== 204) {
      const why = { 401: "GitHub rejected the token (expired or wrong).", 403: "The token is not allowed to run workflows. It needs “Actions: Read and write”.",
        404: "Not found: the token cannot see this repository, or the lookup workflow is not on GitHub yet (push the latest version first).", 422: "GitHub refused the request (is the lookup workflow set up for manual runs?)." }[res.status] || `GitHub returned HTTP ${res.status}.`;
      throw Object.assign(new Error(why), { auth: [401, 403, 404].includes(res.status) });
    }
    const t0 = Date.now();
    let n = 0, runUrl = null;
    while (Date.now() - t0 < TIMEOUT_MS) {
      await sleep(POLL_MS);
      n++;
      let doc = null;
      try { doc = await getJson(`${rawBase()}/data/${symbol}.json`); } catch { /* keep polling */ }
      if (doc && (doc.fetched_ts || 0) > prevTs) return doc;
      if (n % 3 === 0) {
        try {
          const run = (await listRuns()).find((r) => !before.has(r.id));
          if (run) {
            runUrl = run.html_url;
            if (run.status === "completed" && run.conclusion !== "success") throw Object.assign(new Error(`The lookup job did not succeed (${run.conclusion}). Details: ${run.html_url}`), { final: true });
          }
        } catch (e) { if (e.final) throw e; }
      }
      msg(`Fetching ${symbol}… ${Math.round((Date.now() - t0) / 1000)}s (usually 1 to 2 minutes)`);
    }
    throw new Error(`Still no result after 6 minutes.${runUrl ? " Check the job: " + runUrl : " Check the Actions tab on GitHub."}`);
  }

  /* mode: "auto" (use a fresh saved report, else fetch), "cached" (show whatever is saved, any age), "force" (fetch again) */
  async function lookup(raw, mode = "auto") {
    if (busy) return;
    const symbol = L.cleanSymbol(raw);
    if (!symbol) { msg("That does not look like a ticker symbol. Examples: SOFI, TSM, QQQM, D05.SI, 0700.HK, BRK-B.", "err"); return; }
    $("lk-symbol").value = symbol;
    if (symbol !== current) { $("lk-report").innerHTML = ""; current = null; }     // never leave another symbol's report under this one's name
    setBusy(true); showToken(false); msg(`Looking for a saved report on ${symbol}…`);
    try {
      let saved = null;
      try { saved = await getJson(`${rawBase()}/data/${symbol}.json`); } catch { /* offline: fall through */ }
      const savedOk = saved ? L.sanitize(saved) : null;
      const fresh = savedOk && savedOk.report && savedOk.report.found && L.isFresh(savedOk.report);
      if (saved && (mode === "cached" || mode === "peek" || (mode === "auto" && fresh))) { show(saved); return; }
      if (mode === "peek") {            // opened from Holdings: never start a public lookup without an explicit press of "Look up"
        msg(`${symbol} has not been looked up yet. Press "Look up" to fetch it. That saves the symbol on this repository's public lookups branch, so anyone could see it was looked up.`);
        return;
      }
      if (!gh().store.get()) {
        pending = symbol;
        if (saved) show(saved, { note: "To fetch a newer one, add a GitHub token below." });
        else msg(`${symbol} has not been looked up yet. Fetching it needs a GitHub token (one time, steps below).`);
        showToken(true);
        return;
      }
      const doc = await fetchFresh(symbol, saved ? saved.fetched_ts || 0 : 0);
      show(doc);
      loadRecent(true);
    } catch (e) {
      if (e.auth) showToken(true);
      msg(e.message || "Network error.", "err");
    } finally { setBusy(false); }
  }

  function bind() {
    if (bound) return;
    bound = true;
    $("lk-form").onsubmit = (e) => { e.preventDefault(); lookup($("lk-symbol").value, "auto"); };
    $("lk-recent").addEventListener("click", (e) => { const b = e.target.closest("[data-sym]"); if (b) lookup(b.dataset.sym, "cached"); });
    $("lk-token-link").href = "https://github.com/settings/personal-access-tokens/new";
    $("lk-repo").textContent = gh().REPO;
    $("lk-token-save").onclick = () => {
      const v = $("lk-token").value.trim();
      if (!/^[A-Za-z0-9_\-]{20,}$/.test(v)) { msg("That does not look like a GitHub token.", "err"); return; }
      gh().store.set(v); $("lk-token").value = ""; showToken(false);
      const s = pending || $("lk-symbol").value; pending = null;
      if (s) lookup(s, "force");
    };
    $("lk-token-forget").onclick = () => { gh().store.clear(); showToken(false); msg("Token removed from this browser.", ""); };
  }

  window.LookupUI = {
    init(h) { host = h; },
    render() { if (!host || !gh()) return; bind(); loadRecent(false); },
    /* From Holdings: show a saved report if there is one, otherwise wait for the user to press Look up. */
    open(symbol) { if (!host || !gh()) return; bind(); loadRecent(false); lookup(symbol, "peek"); },
    // exposed for tests
    _lookup: lookup, _ageText: ageText,
  };
})();
