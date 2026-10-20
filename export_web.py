"""Export prices from the local SQLite file to site/data.json for the static web app.

    python export_web.py             # export what is already in data/market.db
    python export_web.py --refresh   # download fresh prices from Yahoo first

Also writes site/sector_data.json (about a year of prices for the sector ETFs and stocks).
With --refresh, nothing is written unless every ticker downloaded (failures are retried once),
so a rate-limited run (common on shared CI machines) never replaces good data with a partial file.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import data
from settings import BENCHMARKS, SECTORS, SECTOR_TICKERS, WATCHLIST

SITE = Path(__file__).parent / "site"
OUT = SITE / "data.json"
SECTOR_OUT = SITE / "sector_data.json"
SECTOR_DAYS = 320  # enough for the 200-day average and 1-year high


def export() -> None:
    tickers = list(WATCHLIST) + list(BENCHMARKS)
    prices = data.load_prices(tickers)  # already forward-filled over short holidays
    present = [t for t in tickers if t in prices.columns]
    prices = prices[present].dropna(how="all")
    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "dates": [d.strftime("%Y-%m-%d") for d in prices.index],
        "watchlist": [t for t in WATCHLIST if t in present],
        "benchmarks": {t: n for t, n in BENCHMARKS.items() if t in present},
        "prices": {
            t: [None if v != v else float(f"{v:.7g}") for v in prices[t].tolist()]
            for t in present
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB, {len(present)} tickers, "
          f"{len(prices)} days, last {payload['dates'][-1]})")


def export_sectors() -> None:
    prices = data.load_prices(SECTOR_TICKERS)
    present = [t for t in SECTOR_TICKERS if t in prices.columns]
    prices = prices[present].dropna(how="all").tail(SECTOR_DAYS)
    sectors = {
        name: {"etf": spec["etf"], "stocks": [t for t in spec["stocks"] if t in present]}
        for name, spec in SECTORS.items() if spec["etf"] in present
    }
    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "dates": [d.strftime("%Y-%m-%d") for d in prices.index],
        "sectors": sectors,
        "prices": {t: [None if v != v else float(f"{v:.7g}") for v in prices[t].tolist()] for t in present},
    }
    SECTOR_OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {SECTOR_OUT} ({SECTOR_OUT.stat().st_size / 1e3:.0f} KB, {len(present)} tickers, "
          f"{len(sectors)} sectors, last {payload['dates'][-1]})")


def refresh_all() -> None:
    ok, failed = data.update()
    if failed:  # one retry; Yahoo hiccups are usually transient
        retry = [f.split(" ")[0] for f in failed]
        print("Retrying:", ", ".join(retry))
        ok2, failed = data.update(retry)
        ok += ok2
    print(f"Downloaded {len(ok)} tickers.")
    if failed:
        sys.exit("Refusing to export, failed: " + ", ".join(failed))


if __name__ == "__main__":
    if "--refresh" in sys.argv:
        refresh_all()
    export()
    export_sectors()
