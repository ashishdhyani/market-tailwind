"""Keep sp500.csv (the current S&P 500 constituents and their sectors) up to date.

    python universe.py

The list is committed to the repo, so the app always has one even if the download fails. Run it (the daily
job does) to pick up index changes. Symbols are converted to Yahoo's form (BRK.B -> BRK-B) and GICS sectors
are mapped to the names used in the app. Nothing is written unless the downloaded list looks sane.
"""
import csv
import io
import re
import ssl
import sys
import urllib.request
from pathlib import Path

import certifi

SOURCE = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
OUT = Path(__file__).parent / "sp500.csv"

# GICS sector -> the name shown in the app (the 11 SPDR sector ETFs line up with these)
SECTOR_NAMES = {
    "Information Technology": "Technology", "Communication Services": "Communication Services",
    "Consumer Discretionary": "Consumer Discretionary", "Consumer Staples": "Consumer Staples", "Energy": "Energy",
    "Financials": "Financials", "Health Care": "Health Care", "Industrials": "Industrials", "Materials": "Materials",
    "Real Estate": "Real Estate", "Utilities": "Utilities",
}
SYMBOL = re.compile(r"^[A-Z][A-Z0-9\-]{0,5}$")


def parse(text: str) -> list:
    """CSV text -> [{symbol, name, sector}], raising ValueError if anything looks wrong."""
    rows, seen = [], set()
    for r in csv.DictReader(io.StringIO(text)):
        sym = (r.get("Symbol") or "").strip().upper().replace(".", "-")
        sector = SECTOR_NAMES.get((r.get("GICS Sector") or "").strip())
        if not SYMBOL.match(sym) or sector is None:
            raise ValueError(f"unexpected row: {r}")
        if sym in seen:
            raise ValueError(f"duplicate symbol {sym}")
        seen.add(sym)
        rows.append({"symbol": sym, "name": (r.get("Security") or sym).strip(), "sector": sector})
    if not 450 <= len(rows) <= 560:
        raise ValueError(f"expected about 500 constituents, got {len(rows)}")
    if {r["sector"] for r in rows} != set(SECTOR_NAMES.values()):
        raise ValueError("a sector is missing")
    return sorted(rows, key=lambda r: r["symbol"])


def write(rows: list, path: Path = OUT) -> None:
    with path.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["symbol", "name", "sector"])
        w.writerows([r["symbol"], r["name"], r["sector"]] for r in rows)


def load(path: Path = OUT) -> list:
    with path.open(newline="") as f:
        return [{"symbol": r["symbol"], "name": r["name"], "sector": r["sector"]} for r in csv.DictReader(f)]


def main() -> int:
    ctx = ssl.create_default_context(cafile=certifi.where())
    try:
        req = urllib.request.Request(SOURCE, headers={"User-Agent": "market-tailwind"})
        text = urllib.request.urlopen(req, timeout=30, context=ctx).read().decode("utf-8")
        rows = parse(text)
    except Exception as exc:  # network error or an unexpected format: keep the committed list
        print(f"Could not refresh the S&P 500 list ({type(exc).__name__}: {exc}); keeping {OUT.name}.")
        return 1
    old = {r["symbol"] for r in load()} if OUT.exists() else set()
    new = {r["symbol"] for r in rows}
    write(rows)
    print(f"{len(rows)} constituents. Added: {sorted(new - old) or 'none'}. Removed: {sorted(old - new) or 'none'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
