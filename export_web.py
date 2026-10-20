"""Export prices from the local SQLite file to site/data.json for the static web app.

    python export_web.py             # export what is already in data/market.db
    python export_web.py --refresh   # download fresh prices from Yahoo first

With --refresh, nothing is written unless every ticker downloaded, so a rate-limited
run (common on shared CI machines) never replaces good data with a partial file.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import data
from settings import BENCHMARKS, WATCHLIST

OUT = Path(__file__).parent / "site" / "data.json"


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


if __name__ == "__main__":
    if "--refresh" in sys.argv:
        ok, failed = data.update()
        print(f"Downloaded {len(ok)} tickers.")
        if failed:
            sys.exit("Refusing to export, failed: " + ", ".join(failed))
    export()
