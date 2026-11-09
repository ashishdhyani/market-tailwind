# Market Tailwind

Finds the US sectors with momentum and good news behind them (and suggests stocks and ETFs in them), ranks the full
S&P 500, 15 Singapore stocks, quantum-computing stocks and about 60 ETFs by momentum, trend and risk, and backtests the ranking. Uses only free data (Yahoo Finance via `yfinance`).

## Web version (GitHub Pages, works on iPhone)

`site/` is a static web app: the scoring and backtest (`site/engine.js`) run in the browser on
`site/data.json`. A GitHub Action (`.github/workflows/pages.yml`) refreshes that file from Yahoo
Finance twice a day (8:00 AM Singapore time, Tue-Sat, for the US close; 9:00 PM Singapore time, Mon-Fri, before the US open) (prices via `data.py` / `export_web.py`, headlines via `news.py`, company numbers via `fundamentals.py`) and republishes the site. If Yahoo blocks the refresh, the last good data is kept.

- **Refresh button:** the page has a "Refresh data" button that starts the workflow. The first click asks for a GitHub fine-grained token (this repo only, permission *Actions: Read and write*), kept only in that browser. Or run it by hand: repo → Actions → Run workflow.
- Preview locally: `cd site && python3 -m http.server 8000`, then open http://localhost:8000
- Refresh data locally: `python data.py && python export_web.py && python news.py && python fundamentals.py`
- Check the JS against the Python original: `python tests/crosscheck.py > /tmp/py.json && node tests/crosscheck.js /tmp/py.json` (and `tests/crosscheck_sectors.*`, `tests/test_sentiment.py`, `tests/test_news.py`, `tests/test_fundamentals.*`, `tests/test_detail.js`, `tests/test_holdings.js`, `tests/test_pullbacks.js`, `tests/test_risk.js`, `tests/test_scoreboard.js`, `tests/test_protect.mjs`)

## Python / Streamlit version (original)

Uses a local SQLite file.

## Run it

```bash
pip install -r requirements.txt
python data.py            # download prices into data/market.db (about a minute)
python backtest.py        # print backtest metrics in the terminal
streamlit run app.py      # open the dashboard
```

## Files

| File | Purpose |
|------|---------|
| `settings.py` | Universe: the full S&P 500 (from `sp500.csv`), 15 Singapore stocks, and the hand-picked `EXTRA_GROUPS` (quantum-computing stocks and about 60 ETFs: AI and tech, themes, index and international, commodities, crypto and bonds, sector ETFs). Edit the Singapore list and `EXTRA_GROUPS` here. |
| `universe.py` | Refreshes `sp500.csv` (current S&P 500 members and sectors) from a public dataset. |
| `data.py` | Download prices and store/load them with SQLite. |
| `scoring.py` | Features and composite score, plus the "why" text for each pick. |
| `backtest.py` | Monthly rebalance, next-day fills, costs, benchmark comparison. |
| `app.py` | Streamlit dashboard. |
| `export_web.py` | Export prices from SQLite to `site/data.json` and `site/sector_data.json`. |
| `fundamentals.py` | Download company names and key numbers (forward P/E, PEG, ROE, margins, growth, debt, cash flow, analyst targets) into `site/fundamentals.json`. |
| `news.py`, `sentiment.py` | Download Yahoo Finance headlines per ticker and score their tone into `site/news.json`. |
| `site/` | Static web app (HTML/CSS/JS) published to GitHub Pages. |

## Scoreboard (forward, out-of-sample)

Backtests here are flattered by survivorship bias, so the Scoreboard keeps a record that cannot be: every refresh, `tools/snapshot_picks.mjs` appends the app's **default** picks (Rankings top 5 for each of the six horizons, Pullbacks top 5, and the leader of each of the top 3 sectors) to `site/picks_log.json`, which the workflow commits. Git history therefore shows when each list was written, before anyone knew how it turned out. The Scoreboard tab then measures those exact lists: equal-weighted, bought at the next trading day's close (the same one-day delay as the backtest), against SPY after 1 week, 1 month and 3 months, before costs and taxes. Nothing is backfilled. A damaged log makes the tool stop instead of overwriting it. Early on it is a tiny sample (daily lists overlap), so every average carries its count, a standard error and the number of independent windows. Logic and tests: `site/picks.js`, `site/scoreboard.js`, `tests/test_scoreboard.js`.

## Event risk: earnings and ex-dividend dates

Company data now includes each stock's next earnings and ex-dividend dates (from Yahoo, refreshed daily; `next_earnings` / `ex_div` in `fundamentals.json`). A 📅 marker appears next to any stock reporting within two weeks (Rankings, Pullbacks, Holdings, the planner), the detail panel has a "Coming up" line, Holdings lists upcoming events for what you own, and the planner warns about earnings inside a week. Earnings dates are often expected dates that can shift, so the app says "around"; a missing date means Yahoo has none yet, not that nothing is coming. Past dates are ignored, so a stale file never shows an old event. Tests: `tests/test_fundamentals.*`, `tests/test_detail.js`.

## Portfolio risk check

In Holdings (for positions with share counts) and under every cash-planner result: how the basket has behaved over up to three years of history with today's weights held constant. It shows yearly swings, worst fall from a peak, worst month and day against SPY (or the STI ETF for SGD), beta, how closely the positions moved together, a rough "if the market fell 10/20/30%" estimate from beta, a replay of the market's worst month and quarter, and which positions contribute most of the risk. It describes the past, not the future, and currencies are not converted. Logic and tests: `site/risk.js`, `tests/test_risk.js` (hand-built cases for correlation, beta, drawdown, crash replay and short history).

## Pullbacks (a screen, not a forecast)

The Pullbacks tab lists stocks that fell by at least X% over a chosen window (1 week to 3 months) and ranks them by how much supporting evidence they have, with the evidence for and against on each card: news tone, profitability, analyst target and rating, expected earnings (forward vs trailing P/E), sales growth, valuation, and whether the 6-month trend is still up. A very sharp fall counts as a caution, because analyst targets lag the price. An optional Sector dropdown narrows it to one S&P 500 sector, Singapore or the quantum group (choices are remembered in the browser). ETFs are excluded (no company financials). It is the same for everyone and cannot be backtested (we only have today's analyst and financial data); a falling stock is often falling for a good reason. Logic and tests: `site/pullbacks.js`, `tests/test_pullbacks.js`.

## Cash planner (a calculator, not advice)

In the Holdings tab, enter an amount of cash, the stocks or ETFs **you** are considering and optional weights; the planner works out whole shares, dollar amounts, fees and cash left (and can keep a % back as cash), and shows the app's signals next to each pick plus a sector split. It never chooses what to buy. To save typing you can start the basket from one of the app's own lists (the top Rankings picks, the top Pullbacks, or the leader of each of the top 3 sectors), which are the same for everyone, and then edit it; the app does not blend the analyses into a portfolio for you. Each basket must be in one currency (no FX conversion). Inputs stay in your browser only. The arithmetic is tested, including 400 randomised cases (`tests/test_holdings.js`).

## ETFs and quantum stocks

Besides the S&P 500 and 15 Singapore stocks, the ranking covers hand-picked groups listed in `settings.py` (`EXTRA_GROUPS`): **quantum computing** (IonQ, Rigetti, D-Wave, Quantum Computing Inc, Arqit, SEALSQ, Infleqtion, plus the QTUM ETF) and ETFs in five groups (AI & tech incl. AGIX and AIPO, themes, index/income/international, commodity/crypto/bond, and the 11 sector ETFs). They are ranked with the same price-only score. Funds have no company financials, so the fundamentals checks and loss warnings do not apply to them. Each group has its own button in Controls. These lists are chosen with hindsight, so a backtest that includes them is flattered (the Backtest tab says so). To add a ticker, put it in `EXTRA_GROUPS` and run the refresh. Note: QMCO is Quantum Corporation (data storage), not quantum computing, so it is deliberately not included.

## Horizons

The Horizon selector re-ranks everything for a time window: **Long-term** (12-1 and 6-1 month momentum, the original model), **6 months**, **3 months**, **1 month**, **2 weeks** and **1 week**. The short ones keep the same trend / volatility / near-high parts and replace both momentum terms (55% together) with the return over just that window. The backtest rebalances at a matching cadence: monthly (long-term, 6 months, 3 months, 1 month), every second week (2 weeks) or weekly (1 week). Each horizon is checked against an independent pandas calculation (`tests/crosscheck.*`).

## Loss warnings

The score is price-only, so a stock that reports a loss (negative ROE or net margin, about 4% of the list) can rank high on momentum. Those stocks get a ⚠ and a warning banner, and a Controls switch, "Hide companies that report a loss", removes them from Rankings, Sectors and the chart list. The backtest ignores the switch (today's financials applied to the past would be look-ahead bias).

## My Holdings (private)

The Holdings tab lets you enter what you own (paste rows or load a CSV: `ticker, shares, average cost`, with or without a header row such as `Symbol, Quantity, Avg Price`). It shows each position next to the app's signals (trend, news tone, ranking, fundamentals check), your concentration by sector, and **what changed since the previous data update** (trend, ranking bucket, news tone, fundamentals check, price moves of 5% or more).

- **Private:** holdings are kept only in that browser's local storage. They are not uploaded and never written to this repository (which is public). They do not sync between devices, and the page password does not encrypt them on the device. PDFs are not read; export a CSV from your broker or paste rows.
- **A monitor, not advice:** it reports movement in the indicators and never says buy or sell.
- **Coverage:** only tickers the app has prices for (those on the Rankings and Sectors tabs, plus SPY and ES3.SI). Others are listed as not covered.

## Password protection

The published site is encrypted. `tools/protect.mjs` compresses everything in `site/` and encrypts it (AES-256-GCM, key from your password via PBKDF2 with 600,000 rounds) into `dist/bundle.enc`, next to a small login page. The browser asks for the password, decrypts the app locally and runs it, so the password is never sent anywhere.

**Set it up once:** repo → Settings → Secrets and variables → Actions → New repository secret → name `MARKET_PASSWORD`, value a long passphrase (at least 12 characters; use a few random words). The workflow fails, and publishes nothing, if it is missing. To change the password, update the secret and run the workflow.

**Limits, honestly:**
- It is a gate on the *page*, not real server-side security. Anyone can download `bundle.enc` and try passwords offline at full speed, so a weak password can be cracked. Use a long, unique passphrase and do not reuse it.
- This repository is public. The raw code and market data in `site/` are readable on GitHub, and only the published page is protected. Never commit anything private (a trade statement, account numbers) to this repo.
- Locked on first load; "Keep me signed in" stores a derived key (not the password) in that browser. "Lock app" removes it.

Try it locally: `MARKET_PASSWORD='a long test passphrase' node tools/protect.mjs site dist`, then serve `dist/` (for example `cd dist && python3 -m http.server 8000`). Tests: `node tests/test_protect.mjs`.

## Disclaimer

Market Tailwind is a research tool, **not financial advice**. The rankings, sector views and suggested stocks/ETFs are automated ideas to investigate, not instructions to buy or sell. Do your own research and do not rely on them; investing involves risk, including losing all your money. The same notice appears on every page of the app.

## Caveats

- Survivorship bias: the watchlist is today's winners, which flatters the backtest.
- Past performance does not predict future returns. Treat output as research ideas, not advice.
- `yfinance` is an unofficial scraper; it can break or rate-limit. Data is cached locally.

## Roadmap (all free)

1. Fundamentals from SEC EDGAR (US) as quality/value features.
2. News sentiment: Finnhub free tier + FinBERT running locally.
3. Macro regime features from FRED (rates, inflation, VIX).
4. Add each feature one at a time and keep it only if the backtest improves out of sample.
5. Paper trade for a few months before using real money. IBKR's API can be added later for execution.
