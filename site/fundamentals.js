/* Turns raw fundamentals into investor-style checks. Pure functions; works in the browser and Node.
   Thresholds are common rules of thumb (Graham, Buffett, Lynch, Greenblatt), not laws: they vary by
   sector, so some checks are skipped where they are not meaningful (banks, REITs, utilities). */
(function (root) {
  "use strict";

  const f1 = (x) => x.toFixed(1);
  const pc = (x, d = 1) => (x * 100).toFixed(d) + "%";
  const spc = (x, d = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";

  function money(n, cur) {
    const sym = { USD: "$", SGD: "S$" }[cur] ?? "";
    const a = Math.abs(n);
    const [v, u] = a >= 1e12 ? [a / 1e12, "T"] : a >= 1e9 ? [a / 1e9, "B"] : a >= 1e6 ? [a / 1e6, "M"] : [a, ""];
    return (n < 0 ? "-" : "") + sym + (u ? v.toFixed(v >= 100 ? 0 : 1) + u : v.toFixed(2));
  }

  /* core: counts towards the "x of y checks" summary. dir: "low" = smaller is better, "high" = bigger is better.
     good/ok are the cut-offs; anything past `ok` is "bad". */
  const CHECKS = {
    fwd_pe: { label: "Forward P/E", core: true, dir: "low", good: 20, ok: 30, fmt: (v) => f1(v) + "×",
      help: "Share price ÷ expected earnings per share over the next 12 months: what you pay for $1 of future profit. Lower is cheaper. Graham liked 15 or less; the broad market is usually around 20.",
      good_t: "cheap vs. the ~20× market norm", bad_t: "expensive: the price assumes strong growth" },
    peg: { label: "PEG ratio", core: true, dir: "low", good: 1, ok: 2, fmt: (v) => v.toFixed(2),
      help: "P/E divided by expected earnings growth. Peter Lynch looked for 1 or less: you are not overpaying for the growth. Above 2 is pricey.",
      good_t: "growth looks cheap (Lynch: ≤1)", bad_t: "paying a lot for the growth (>2)" },
    roe: { label: "Return on equity", core: true, dir: "high", good: 0.15, ok: 0.08, fmt: (v) => pc(v, 0),
      help: "Profit ÷ shareholders' equity: how well the company turns owners' money into profit. Buffett looks for 15% or more, year after year. Buybacks can inflate it.",
      good_t: "efficient profit engine (Buffett: ≥15%)", bad_t: "weak returns on owners' capital" },
    net_margin: { label: "Net profit margin", core: true, dir: "high", good: 0.15, ok: 0.08, fmt: (v) => pc(v, 1),
      help: "Cents of profit kept from each $1 of sales. High margins often signal pricing power or a moat. Compare within a sector: grocers run thin, software runs high.",
      good_t: "keeps a lot of each sales dollar", bad_t: "thin margins leave little room for error" },
    rev_growth: { label: "Revenue growth", core: true, dir: "high", good: 0.10, ok: 0.03, fmt: (v) => spc(v, 1),
      help: "Sales growth versus a year earlier. Growing sales are the base for growing profits.",
      good_t: "sales growing fast (≥10%)", bad_t: "sales barely growing or shrinking" },
    earn_growth: { label: "Earnings growth", core: true, dir: "high", good: 0.10, ok: 0, fmt: (v) => spc(v, 0),
      help: "Profit growth versus a year earlier. Rising profits are what ultimately move a stock price.",
      good_t: "profits growing (≥10%)", bad_t: "profits shrinking" },
    de: { label: "Debt / equity", core: true, dir: "low", good: 0.5, ok: 1.5, fmt: (v) => v.toFixed(2) + "×",
      help: "Total debt ÷ shareholders' equity. Graham and Buffett prefer low debt so a bad year cannot sink the company. Not meaningful for banks and similar.",
      good_t: "conservative balance sheet (≤0.5×)", bad_t: "heavily indebted (>1.5×)" },
    fcf_yield: { label: "Free-cash-flow yield", core: true, dir: "high", good: 0.04, ok: 0.02, fmt: (v) => pc(v, 1),
      help: "Cash left after running and investing in the business, ÷ market value. Buffett and Greenblatt favour real cash over accounting profit. 4% or more is attractive.",
      good_t: "generates plenty of cash for its price", bad_t: "little or negative free cash" },
    ev_ebitda: { label: "EV / EBITDA", dir: "low", good: 12, ok: 18, fmt: (v) => f1(v) + "×",
      help: "Whole-company value (including debt) ÷ operating profit before depreciation. A debt-aware cousin of P/E; under ~12 is cheap, over ~18 is rich." },
    pb: { label: "Price / book", dir: "low", good: 3, ok: 6, fmt: (v) => f1(v) + "×",
      help: "Price ÷ the accounting value of the company's net assets. Graham wanted under 1.5; asset-light businesses (software, brands) legitimately trade much higher." },
    pe: { label: "Trailing P/E", dir: "low", good: 20, ok: 30, fmt: (v) => f1(v) + "×",
      help: "Price ÷ earnings over the last 12 months (the Forward P/E above uses expected earnings)." },
    current_ratio: { label: "Current ratio", dir: "high", good: 1.5, ok: 1, fmt: (v) => v.toFixed(2),
      help: "Short-term assets ÷ short-term bills. Above 1.5 means comfortable; below 1 means it relies on new financing to pay its bills." },
    payout: { label: "Payout ratio", info: true, fmt: (v) => pc(v, 0),
      help: "Share of profit paid out as dividends. Under ~60% usually leaves room to keep paying and growing the dividend." },
    beta: { label: "Beta", dir: "low", good: 1, ok: 1.3, fmt: (v) => v.toFixed(2),
      help: "How much the stock swings versus the overall market (1 = same). Above 1.3 means bigger ups and downs." },
  };
  const CORE = Object.keys(CHECKS).filter((k) => CHECKS[k].core);

  // Checks that are misleading for some kinds of company.
  const SKIP = {
    "Financial Services": ["de", "fcf_yield", "ev_ebitda", "current_ratio"],
    "Real Estate": ["fwd_pe", "pe", "peg", "ev_ebitda", "de", "fcf_yield", "current_ratio"],
    "Utilities": ["fcf_yield", "current_ratio"],
  };
  const OVERRIDE = { Utilities: { de: { good: 1.2, ok: 2.5 } } };

  function status(spec, v) {
    if (spec.info) return "info";
    if (spec.dir === "low" && v <= 0) return "bad";  // negative earnings etc.
    if (spec.dir === "low") return v <= spec.good ? "good" : v <= spec.ok ? "ok" : "bad";
    return v >= spec.good ? "good" : v >= spec.ok ? "ok" : "bad";
  }

  function mcapLabel(m) { return m >= 2e11 ? "Mega-cap" : m >= 1e10 ? "Large-cap" : m >= 2e9 ? "Mid-cap" : "Small-cap"; }

  function recLabel(r) { return r <= 1.5 ? "Strong Buy" : r <= 2.5 ? "Buy" : r <= 3.5 ? "Hold" : r <= 4.5 ? "Underperform" : "Sell"; }

  /* info: one entry of fundamentals.json; price: latest price in the same currency. */
  function evaluate(info, price) {
    if (!info) return null;
    const cur = info.currency;
    const out = { name: info.name, type: info.type, sector: info.sector, industry: info.industry, metrics: [], notes: [] };
    if (info.type === "ETF") return evaluateEtf(info, price, out);

    const skip = new Set(SKIP[info.sector] || []);
    const value = (k) => (k === "fcf_yield" ? (info.fcf != null && info.mcap ? info.fcf / info.mcap : null) : info[k]);
    for (const k of Object.keys(CHECKS)) {
      const spec = { ...CHECKS[k], ...((OVERRIDE[info.sector] || {})[k] || {}) };
      const v = value(k);
      if (skip.has(k)) { if (spec.core) out.metrics.push({ key: k, label: spec.label, text: "n/a", status: "na", core: true, help: spec.help, note: "Not meaningful for this kind of company" }); continue; }
      if (v == null) continue;
      const st = status(spec, v);
      out.metrics.push({ key: k, label: spec.label, value: v, text: spec.dir === "low" && v <= 0 && spec.core ? "Negative" : spec.fmt(v),
        status: st, core: !!spec.core, help: spec.help, good_t: spec.good_t, bad_t: spec.bad_t });
    }
    if (info.div_yield != null) out.metrics.push({ key: "div", label: "Dividend yield", value: info.div_yield, text: pc(info.div_yield, 2), status: "info", help: "Yearly dividend ÷ share price: cash paid to you for holding the stock." });
    if (info.rec != null) out.metrics.push({ key: "rec", label: "Analyst view", value: info.rec, text: `${recLabel(info.rec)} (${info.rec.toFixed(1)}/5${info.analysts ? ", " + info.analysts + " analysts" : ""})`,
      status: info.rec <= 2.5 ? "good" : info.rec <= 3.5 ? "ok" : "bad", help: "Average Wall Street recommendation: 1 = Strong Buy, 3 = Hold, 5 = Sell. Analysts are often optimistic, so treat it as one input." });
    if (info.target != null && price) {
      const up = info.target / price - 1;
      out.metrics.push({ key: "target", label: "Analyst target", value: up, text: `${money(info.target, cur)} (${spc(up, 0)} vs price)`,
        status: up >= 0.1 ? "good" : up >= 0 ? "ok" : "bad", help: "Average 12-month price target. Negative means the price already sits above what analysts expect." });
    }
    if (info.hi52 && info.lo52 && price) {
      const pos = (price - info.lo52) / (info.hi52 - info.lo52);
      out.metrics.push({ key: "range", label: "52-week range", value: pos, text: `${money(info.lo52, cur)} – ${money(info.hi52, cur)} (at ${pc(Math.min(1, Math.max(0, pos)), 0)} of range)`, status: "info",
        help: "Where today's price sits between the lowest and highest price of the past year." });
    }

    const core = out.metrics.filter((m) => m.core && m.status !== "na");
    const good = core.filter((m) => m.status === "good").length;
    out.summary = core.length >= 3
      ? { good, of: core.length, label: good / core.length >= 0.75 ? "Strong" : good / core.length >= 0.4 ? "Mixed" : "Weak" }
      : { good, of: core.length, label: "Not enough data" };
    out.strengths = core.filter((m) => m.status === "good").map((m) => `${m.label} ${m.text}: ${m.good_t}`);
    out.cautions = core.filter((m) => m.status === "bad").map((m) => `${m.label} ${m.text}: ${m.bad_t}`);
    if (skip.size) out.notes.push(`Some value checks are skipped for ${info.sector.toLowerCase()} companies because they are not meaningful for them.`);
    out.facts = [info.mcap ? `${mcapLabel(info.mcap)} (${money(info.mcap, cur)})` : null, info.industry].filter(Boolean);
    return out;
  }

  function evaluateEtf(info, price, out) {
    const cur = info.currency, M = out.metrics;
    if (info.expense != null) M.push({ key: "expense", label: "Expense ratio", value: info.expense, text: pc(info.expense, 2) + " / year", status: info.expense <= 0.002 ? "good" : info.expense <= 0.005 ? "ok" : "bad", help: "Yearly fee taken from the fund. Under 0.20% is cheap for a broad sector fund." });
    if (info.div_yield != null) M.push({ key: "div", label: "Dividend yield", value: info.div_yield, text: pc(info.div_yield, 2), status: "info", help: "Yearly distributions ÷ price." });
    if (info.aum != null) M.push({ key: "aum", label: "Fund size", value: info.aum, text: money(info.aum, cur), status: info.aum >= 1e9 ? "good" : info.aum >= 1e8 ? "ok" : "bad", help: "Assets under management. Bigger funds trade with tighter spreads and are less likely to close." });
    if (info.pe != null) M.push({ key: "pe", label: "P/E of holdings", value: info.pe, text: f1(info.pe) + "×", status: "info", help: "Average trailing P/E of the stocks inside the fund: how expensive the whole sector is." });
    if (info.pb != null) M.push({ key: "pb", label: "Price / book of holdings", value: info.pb, text: f1(info.pb) + "×", status: "info", help: "Average price ÷ book value of the stocks inside the fund." });
    if (info.ret5y != null) M.push({ key: "ret5y", label: "5-yr avg. return", value: info.ret5y, text: spc(info.ret5y, 1) + " / year", status: "info", help: "Average yearly return over five years, per Yahoo. Past results do not predict the future." });
    if (info.hi52 && info.lo52 && price) {
      const pos = (price - info.lo52) / (info.hi52 - info.lo52);
      M.push({ key: "range", label: "52-week range", value: pos, text: `${money(info.lo52, cur)} – ${money(info.hi52, cur)} (at ${pc(Math.min(1, Math.max(0, pos)), 0)} of range)`, status: "info", help: "Where today's price sits between the lowest and highest price of the past year." });
    }
    out.summary = null; out.strengths = []; out.cautions = [];
    out.facts = [info.category, info.family].filter(Boolean);
    out.notes.push("ETFs hold many companies, so company-level checks do not apply; the numbers above describe the fund and its holdings.");
    return out;
  }

  /* One-line numbers for list rows: "Fwd P/E 9.8× · ROE 23% · Rev +59%". */
  function brief(info) {
    if (!info) return "";
    if (info.type === "ETF") return [info.expense != null ? `Fee ${pc(info.expense, 2)}` : null, info.div_yield != null ? `Yield ${pc(info.div_yield, 1)}` : null].filter(Boolean).join(" · ");
    return [info.fwd_pe != null && info.fwd_pe > 0 ? `Fwd P/E ${f1(info.fwd_pe)}×` : null, info.roe != null ? `ROE ${pc(info.roe, 0)}` : null,
      info.rev_growth != null ? `Rev ${spc(info.rev_growth, 0)}` : null].filter(Boolean).join(" · ");
  }

  const GURUS = [
    { who: "Benjamin Graham", idea: "Buy with a margin of safety: modest P/E and price-to-book, low debt, steady dividends.", metrics: "Forward P/E, Price/book, Debt/equity" },
    { who: "Warren Buffett", idea: "Wonderful businesses at fair prices: high, steady returns on equity, strong margins, little debt, plenty of real cash.", metrics: "ROE, Net margin, Debt/equity, Free-cash-flow yield" },
    { who: "Peter Lynch", idea: "Growth at a reasonable price: earnings growing faster than the P/E suggests.", metrics: "PEG ratio, Earnings growth" },
    { who: "Joel Greenblatt", idea: "Good and cheap: high returns on capital bought at a high earnings/cash yield.", metrics: "Free-cash-flow yield, EV/EBITDA, ROE" },
  ];

  const api = { CHECKS, CORE, evaluate, brief, money, mcapLabel, recLabel, GURUS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Fundamentals = api;
})(typeof self !== "undefined" ? self : this);
