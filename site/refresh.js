/* "Refresh data" button: starts the GitHub Actions workflow, shows progress, reloads when it is done.
   Starting a workflow needs a GitHub token, so the first click asks for one. The token is kept only in
   this browser (localStorage), is never sent anywhere except api.github.com, and can be forgotten here.
   A fine-grained token limited to this one repository with "Actions: Read and write" is enough. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const WORKFLOW = "pages.yml", REF = "main", KEY = "mt_gh_token";
  const POLL_MS = 8000, TIMEOUT_MS = 8 * 60 * 1000;

  // On https://<owner>.github.io/<repo>/ derive the repo from the URL; elsewhere (local preview) use the defaults.
  const onPages = location.hostname.endsWith(".github.io");
  const OWNER = onPages ? location.hostname.split(".")[0] : "ashishdhyani";
  const REPO = onPages ? location.pathname.split("/")[1] || "market-tailwind" : "market-tailwind";
  const API = `https://api.github.com/repos/${OWNER}/${REPO}/actions`;

  let memToken = null, busy = false;
  const store = {
    get() { try { return localStorage.getItem(KEY) || memToken; } catch { return memToken; } },
    set(v) { memToken = v; try { localStorage.setItem(KEY, v); } catch { /* private mode: memory only */ } },
    clear() { memToken = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };

  const say = (msg, kind) => { const el = $("refresh-msg"); el.textContent = msg; el.className = "refresh-msg " + (kind || ""); el.hidden = !msg; };
  const showForm = (on) => { $("refresh-form").hidden = !on; if (on) $("refresh-token").focus(); };
  const setBusy = (b) => { busy = b; $("refresh-btn").disabled = b; $("refresh-btn").textContent = b ? "Refreshing…" : "↻ Refresh data"; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function listRuns() {  // public repo: no token needed to read
    const r = await fetch(`${API}/runs?per_page=10`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`Could not read run status (HTTP ${r.status}).`);
    return (await r.json()).workflow_runs || [];
  }

  async function dispatch(token) {
    return fetch(`${API}/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: REF }),
    });
  }

  async function start() {
    if (busy) return;
    const token = store.get();
    if (!token) { showForm(true); say("Paste a GitHub token once to enable this button (steps below).", ""); return; }
    setBusy(true); showForm(false); say("Starting the refresh…");
    try {
      const before = new Set((await listRuns()).map((r) => r.id));
      const res = await dispatch(token);
      if (res.status !== 204) {
        const why = { 401: "GitHub rejected the token (expired or wrong).", 403: "The token is not allowed to run workflows. It needs “Actions: Read and write”.",
          404: "Not found: the token cannot see this repository, or the workflow file is missing.", 422: "GitHub refused the request (is the workflow set up for manual runs?)." }[res.status] || `GitHub returned HTTP ${res.status}.`;
        say(why, "err");
        if (res.status === 401 || res.status === 403 || res.status === 404) showForm(true);
        setBusy(false);
        return;
      }
      say("Refresh started. Downloading prices, news and company data takes about 2 minutes…");
      const t0 = Date.now();
      let run = null;
      while (Date.now() - t0 < TIMEOUT_MS) {
        await sleep(POLL_MS);
        const runs = await listRuns();
        run = runs.find((r) => !before.has(r.id) && r.event === "workflow_dispatch") || run;
        if (run && run.status === "completed") break;
        if (run) say(`Refreshing… (${run.status.replace("_", " ")}, ${Math.round((Date.now() - t0) / 1000)}s)`);
      }
      if (run && run.status === "completed" && run.conclusion === "success") {
        say("Done. Loading the new data…", "ok");
        await sleep(6000);  // let GitHub Pages publish
        location.reload();
        return;
      }
      if (run && run.status === "completed") say(`The refresh did not succeed (${run.conclusion}). Open the run on GitHub to see why: ${run.html_url}`, "err");
      else say("Still running after 8 minutes. Check the Actions tab on GitHub, then reload this page.", "err");
    } catch (e) {
      say(e.message || "Network error.", "err");
    }
    setBusy(false);
  }

  function init() {
    if (!$("refresh-btn")) return;
    $("refresh-btn").onclick = start;
    $("refresh-link").href = `https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`;
    $("refresh-token-link").href = "https://github.com/settings/personal-access-tokens/new";
    $("refresh-repo").textContent = REPO;
    $("refresh-save").onclick = () => {
      const v = $("refresh-token").value.trim();
      if (!/^[A-Za-z0-9_\-]{20,}$/.test(v)) { say("That does not look like a GitHub token.", "err"); return; }
      store.set(v); $("refresh-token").value = ""; showForm(false); say("Token saved in this browser. Starting…"); start();
    };
    $("refresh-forget").onclick = () => { store.clear(); say("Token removed from this browser.", ""); showForm(false); };
    $("refresh-forget").hidden = !store.get();
    $("refresh-btn").addEventListener("click", () => { $("refresh-forget").hidden = !store.get(); });
  }
  init();
})();
