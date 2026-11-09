# Market Tailwind

Finds the US sectors with momentum and good news behind them (and suggests stocks and ETFs in them), ranks a
watchlist of US and Singapore stocks by momentum, trend and risk, and backtests the ranking. Uses only free data (Yahoo Finance via `yfinance`).

## Web version (GitHub Pages, works on iPhone)

`site/` is a static web app: the scoring and backtest (`site/engine.js`) run in the browser on
`site/data.json`. A GitHub Action (`.github/workflows/pages.yml`) refreshes that file from Yahoo
Finance twice a day (8:00 AM Singapore time, Tue-Sat, for the US close; 9:00 PM Singapore time, Mon-Fri, before the US open) (prices via `data.py` / `export_web.py`, headlines via `news.py`, company numbers via `fundamentals.py`) and republishes the site. If Yahoo blocks the refresh, the last good data is kept.

- **Refresh button:** the page has a "Refresh data" button that starts the workflow. The first click asks for a GitHub fine-grained token (this repo only, permission *Actions: Read and write*), kept only in that browser. Or run it by hand: repo → Actions → Run workflow.
- Preview locally: `cd site && python3 -m http.server 8000`, then open http://localhost:8000
- Refresh data locally: `python data.py && python export_web.py && python news.py && python fundamentals.py`
- Check the JS against the Python original: `python tests/crosscheck.py > /tmp/py.json && node tests/crosscheck.js /tmp/py.json` (and `tests/crosscheck_sectors.*`, `tests/test_sentiment.py`, `tests/test_news.py`, `tests/test_fundamentals.*`, `tests/test_detail.js`, `tests/test_holdings.js`, `tests/test_protect.mjs`)

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
| `settings.py` | Watchlist, benchmarks, start date. Edit the tickers here. |
| `data.py` | Download prices and store/load them with SQLite. |
| `scoring.py` | Features and composite score, plus the "why" text for each pick. |
| `backtest.py` | Monthly rebalance, next-day fills, costs, benchmark comparison. |
| `app.py` | Streamlit dashboard. |
| `export_web.py` | Export prices from SQLite to `site/data.json` and `site/sector_data.json`. |
| `fundamentals.py` | Download company names and key numbers (forward P/E, PEG, ROE, margins, growth, debt, cash flow, analyst targets) into `site/fundamentals.json`. |
| `news.py`, `sentiment.py` | Download Yahoo Finance headlines per ticker and score their tone into `site/news.json`. |
| `site/` | Static web app (HTML/CSS/JS) published to GitHub Pages. |

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
