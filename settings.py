"""Project settings: where data lives and which stocks to analyze."""
import csv
from pathlib import Path

ROOT = Path(__file__).parent
DB_PATH = ROOT / "data" / "market.db"
START_DATE = "2012-01-01"

# --- US: the full S&P 500, read from sp500.csv (refreshed by universe.py). Yahoo symbols: BRK.B -> BRK-B.
SP500_FILE = ROOT / "sp500.csv"
with SP500_FILE.open(newline="") as _f:
    SP500 = [{"symbol": r["symbol"], "name": r["name"], "sector": r["sector"]} for r in csv.DictReader(_f)]
US = [r["symbol"] for r in SP500]

# --- Singapore: a hand-picked set of large SGX stocks (".SI" suffix). Edit freely.
SG = [
    "D05.SI", "O39.SI", "U11.SI",  # DBS, OCBC, UOB
    "Z74.SI", "C6L.SI", "S63.SI",  # Singtel, SIA, ST Engineering
    "C38U.SI", "A17U.SI",          # CapitaLand Integrated Commercial Trust, CapitaLand Ascendas REIT
    "F34.SI", "BN4.SI", "Y92.SI", "C07.SI", "G13.SI", "U96.SI", "S68.SI",
]
WATCHLIST = US + SG

# Used only for comparison in the backtest, never ranked or picked.
BENCHMARKS = {"SPY": "S&P 500 ETF", "ES3.SI": "STI ETF (Singapore)"}

# --- US sectors for the Sectors view: each sector's SPDR ETF plus every S&P 500 member in it.
SECTOR_ETFS = {
    "Technology": "XLK", "Communication Services": "XLC", "Consumer Discretionary": "XLY", "Consumer Staples": "XLP",
    "Energy": "XLE", "Financials": "XLF", "Health Care": "XLV", "Industrials": "XLI", "Materials": "XLB",
    "Real Estate": "XLRE", "Utilities": "XLU",
}
SECTORS = {
    name: {"etf": etf, "stocks": [r["symbol"] for r in SP500 if r["sector"] == name]}
    for name, etf in SECTOR_ETFS.items()
}
SECTOR_TICKERS = sorted({t for s in SECTORS.values() for t in [s["etf"], *s["stocks"]]})

# Index feeds whose headlines are shown as "US market" news (context only; not part of any score).
MARKET_FEEDS = ["^GSPC", "^DJI", "^IXIC"]  # S&P 500, Dow, Nasdaq
