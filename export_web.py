"""Export prices from the local SQLite file to site/data.json for the static web app.

    python export_web.py             # export what is already in data/market.db
    python export_web.py --refresh   # download fresh prices from Yahoo first

The database keeps history back to 2012, but the page only gets prices from HISTORY_START: with ~500 stocks
that keeps the download small enough for a phone while still covering the 2020 crash.

With --refresh, a few failed tickers are tolerated (Yahoo hiccups, a just-delisted name), but nothing is
written if a benchmark or sector ETF failed or more than MAX_MISSING_FRAC of all tickers failed, so a
rate-limited run never replaces good data with a poor file.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import data
from settings import BENCHMARKS, SECTOR_ETFS, SECTOR_TICKERS, SECTORS, SG, WATCHLIST

SITE = Path(__file__).parent / "site"
OUT = SITE / "data.json"
HISTORY_START = "2020-01-01"
SIG_DIGITS = 5            # relative precision (works for tiny dividend-adjusted prices too); ~0.003% on a daily return
MAX_MISSING_FRAC = 0.03
ALL_TICKERS = sorted(set(WATCHLIST) | set(BENCHMARKS) | set(SECTOR_TICKERS))


def build_groups(present: set) -> list:
    """Groups the app lets you filter by: the 11 sectors (with their ETF) and Singapore."""
    groups = []
    for name, etf in SECTOR_ETFS.items():
        stocks = [t for t in SECTORS[name]["stocks"] if t in present]
        if etf in present and stocks:
            groups.append({"name": name, "etf": etf, "tickers": stocks})
    sg = [t for t in SG if t in present]
    if sg:
        groups.append({"name": "Singapore", "tickers": sg})
    return groups


def export() -> None:
    wanted = sorted(set(WATCHLIST) | set(BENCHMARKS) | set(SECTOR_ETFS.values()))
    prices = data.load_prices(wanted)  # already forward-filled over short holidays
    prices = prices.loc[HISTORY_START:]
    present = [t for t in wanted if t in prices.columns and prices[t].notna().any()]
    prices = prices[present].dropna(how="all")
    present_set = set(present)
    watchlist = [t for t in WATCHLIST if t in present_set]
    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "dates": [d.strftime("%Y-%m-%d") for d in prices.index],
        "watchlist": watchlist,
        "benchmarks": {t: n for t, n in BENCHMARKS.items() if t in present_set},
        "groups": build_groups(present_set),
        "prices": {
            t: [None if v != v else float(f"{v:.{SIG_DIGITS}g}") for v in prices[t].tolist()]
            for t in present
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    missing = [t for t in WATCHLIST if t not in present_set]
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB, {len(present)} tickers, {len(watchlist)} ranked stocks, "
          f"{len(prices)} days from {payload['dates'][0]}, last {payload['dates'][-1]})"
          + (f"; no data for {len(missing)}: {', '.join(missing[:12])}{'…' if len(missing) > 12 else ''}" if missing else ""))


def refresh_all() -> None:
    ok, failed = data.update(ALL_TICKERS, pause=0.2)
    if failed:  # one retry; Yahoo hiccups are usually transient
        retry = [f.split(" ")[0] for f in failed]
        print(f"Retrying {len(retry)}: {', '.join(retry[:15])}")
        ok2, failed = data.update(retry, pause=1.0)
        ok += ok2
    print(f"Downloaded {len(ok)} of {len(ALL_TICKERS)} tickers.")
    bad = [f.split(" ")[0] for f in failed]
    critical = [t for t in bad if t in BENCHMARKS or t in SECTOR_ETFS.values()]
    if critical or len(bad) > MAX_MISSING_FRAC * len(ALL_TICKERS):
        sys.exit(f"Refusing to export: {len(bad)} failed ({', '.join(bad[:20])}); critical: {critical or 'none'}")
    if bad:
        print(f"Continuing without {len(bad)} tickers: {', '.join(bad)}")


if __name__ == "__main__":
    if "--refresh" in sys.argv:
        refresh_all()
    export()
