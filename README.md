# Investment Ideas Lab (free stack)

Ranks a watchlist of US and Singapore stocks by momentum, trend and risk, and backtests
the ranking. Uses only free data (Yahoo Finance via `yfinance`).

## Web version (GitHub Pages, works on iPhone)

`site/` is a static web app: the scoring and backtest (`site/engine.js`) run in the browser on
`site/data.json`. A GitHub Action (`.github/workflows/pages.yml`) refreshes that file from Yahoo
Finance every weekday and republishes the site. If Yahoo blocks the refresh, the last good data is kept.

- Preview locally: `cd site && python3 -m http.server 8000`, then open http://localhost:8000
- Refresh data locally: `python data.py && python export_web.py`
- Check the JS port against the Python original: `python tests/crosscheck.py > /tmp/py.json && node tests/crosscheck.js /tmp/py.json`

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
| `export_web.py` | Export prices from SQLite to `site/data.json`. |
| `site/` | Static web app (HTML/CSS/JS) published to GitHub Pages. |

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
