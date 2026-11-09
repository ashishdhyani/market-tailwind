"""Download company names and key fundamentals from Yahoo Finance (via yfinance) and write
site/fundamentals.json for the web app.

    python fundamentals.py

Units are normalised so the web app never has to guess: every ratio that is a percentage is stored
as a fraction (0.15 = 15%), debt/equity as a plain ratio (0.5 = 50%). Missing values are left out.
Nothing is written if too many tickers fail, so a blocked run keeps the previous file.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

from settings import BENCHMARKS, SECTOR_TICKERS, WATCHLIST

OUT = Path(__file__).parent / "site" / "fundamentals.json"
MIN_OK = 0.8
WORKERS = 3


def _num(v):
    return float(v) if isinstance(v, (int, float)) and v == v and abs(v) != float("inf") else None


def _sig(v, digits=5):
    return None if v is None else float(f"{v:.{digits}g}")


def normalize(info: dict) -> dict:
    """Pick and clean the fields the app shows. Pure function (unit-tested)."""
    g = lambda k: _num(info.get(k))  # noqa: E731
    price = g("currentPrice") or g("regularMarketPrice") or g("navPrice")
    out = {
        "name": info.get("longName") or info.get("shortName") or info.get("displayName"),
        "type": info.get("quoteType"),
        "sector": info.get("sector"), "industry": info.get("industry"),
        "category": info.get("category"), "family": info.get("fundFamily"),
        "currency": info.get("currency"),
        "mcap": g("marketCap"), "aum": g("netAssets"),
        "fwd_pe": g("forwardPE"), "pe": g("trailingPE"),
        "peg": g("trailingPegRatio") if g("trailingPegRatio") is not None else g("pegRatio"),
        "pb": g("priceToBook"), "ps": g("priceToSalesTrailing12Months"), "ev_ebitda": g("enterpriseToEbitda"),
        "eps_fwd": g("forwardEps"), "eps_ttm": g("trailingEps"),
        "roe": g("returnOnEquity"), "roa": g("returnOnAssets"),
        "gross_margin": g("grossMargins"), "op_margin": g("operatingMargins"), "net_margin": g("profitMargins"),
        "rev_growth": g("revenueGrowth"),
        "earn_growth": g("earningsGrowth") if g("earningsGrowth") is not None else g("earningsQuarterlyGrowth"),
        "current_ratio": g("currentRatio"), "fcf": g("freeCashflow"),
        "payout": g("payoutRatio"), "beta": g("beta") if g("beta") is not None else g("beta3Year"),
        "target": g("targetMeanPrice"), "rec": g("recommendationMean"), "analysts": g("numberOfAnalystOpinions"),
        "hi52": g("fiftyTwoWeekHigh"), "lo52": g("fiftyTwoWeekLow"),
        "ret5y": g("fiveYearAverageReturn"),
    }
    de = g("debtToEquity")                      # Yahoo reports percent (78 = 0.78x)
    out["de"] = de / 100 if de is not None else None
    ner = g("netExpenseRatio")                  # Yahoo reports percent (0.08 = 0.08%)
    out["expense"] = ner / 100 if ner is not None else None
    rate = g("dividendRate")                    # dividend yield from $ per share, not Yahoo's ambiguous % field
    if rate is not None and price:
        out["div_yield"] = rate / price
    elif out["type"] == "ETF" and g("dividendYield") is not None:
        out["div_yield"] = g("dividendYield") / 100
    elif g("trailingAnnualDividendYield") is not None:
        out["div_yield"] = g("trailingAnnualDividendYield")
    return {k: (_sig(v) if isinstance(v, float) else v) for k, v in out.items() if v not in (None, "")}


def fetch(ticker: str, retries: int = 1) -> dict:
    for attempt in range(retries + 1):
        try:
            info = yf.Ticker(ticker).info
            if info and (info.get("longName") or info.get("shortName")):
                return normalize(info)
        except Exception:  # network hiccup, rate limit...
            pass
        time.sleep(1.5)
    return {}


def _age_hours(path: Path):
    try:
        gen = datetime.strptime(json.loads(path.read_text())["generated"], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - gen).total_seconds() / 3600
    except (OSError, ValueError, KeyError):
        return None


def should_skip(age_hours, limit_hours, tickers, previous) -> bool:
    """Skip a refresh only if the file is recent AND already has every current ticker (so a newly added ETF or
    stock gets its numbers straight away instead of waiting for the next daily refresh)."""
    return age_hours is not None and age_hours < limit_hours and all(t in previous for t in tickers)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    tickers = sorted(set(WATCHLIST) | set(BENCHMARKS) | set(SECTOR_TICKERS))
    try:
        previous = json.loads(OUT.read_text()).get("items", {})
    except (OSError, ValueError):
        previous = {}
    if "--max-age-hours" in argv:  # skip when the file is recent: these numbers change slowly
        limit = float(argv[argv.index("--max-age-hours") + 1])
        age = _age_hours(OUT)
        if should_skip(age, limit, tickers, previous):
            print(f"fundamentals.json is {age:.1f} h old (< {limit:g} h) and complete: skipping.")
            return 0
        missing = [t for t in tickers if t not in previous]
        if missing:
            print(f"{len(missing)} tickers have no numbers yet ({', '.join(missing[:8])}...): refreshing.")

    def load(t):
        time.sleep(0.15)
        return t, fetch(t)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(load, tickers))
    items, failed, kept = {}, [], 0
    for t, d in results:
        if d.get("name"):
            items[t] = d
        else:
            failed.append(t)
            if t in previous:      # keep the last known numbers rather than dropping the company
                items[t] = previous[t]
                kept += 1
    fresh = len(tickers) - len(failed)
    print(f"Fundamentals refreshed for {fresh}/{len(tickers)} tickers ({kept} failed ones kept from the previous file).")
    if failed:
        print("Failed:", ", ".join(failed[:40]) + ("…" if len(failed) > 40 else ""))
    if fresh < MIN_OK * len(tickers):
        print("Too few tickers loaded; keeping the existing fundamentals.json.")
        return 1
    OUT.write_text(json.dumps({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "items": items},
                              separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
