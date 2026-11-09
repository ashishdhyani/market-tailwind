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

# Used only for comparison in the backtest, never ranked or picked.
BENCHMARKS = {"SPY": "S&P 500 ETF", "ES3.SI": "STI ETF (Singapore)"}

# --- US sectors for the Sectors view: each sector's SPDR ETF plus every S&P 500 member in it.
SECTOR_ETFS = {
    "Technology": "XLK", "Communication Services": "XLC", "Consumer Discretionary": "XLY", "Consumer Staples": "XLP",
    "Energy": "XLE", "Financials": "XLF", "Health Care": "XLV", "Industrials": "XLI", "Materials": "XLB",
    "Real Estate": "XLRE", "Utilities": "XLU",
}
# --- ETFs and themed stocks ranked alongside the stocks. Hand-picked (edit freely): they are chosen with hindsight,
# so backtests that include them are flattered; untick their groups in the app's Controls for a cleaner test.
EXTRA_GROUPS = {
    "Quantum computing": ["IONQ", "RGTI", "QBTS", "QUBT", "ARQQ", "LAES", "INFQ", "QTUM"],   # QTUM is the quantum ETF
    "AI & tech ETFs": ["AGIX", "AIPO", "AIQ", "BOTZ", "ROBO", "SMH", "SOXX", "IGV", "SKYY", "CIBR", "ARKK", "ARKQ"],
    "Theme ETFs": ["PAVE", "GRID", "URA", "NLR", "ICLN", "TAN", "LIT", "XBI", "IBB", "ITA"],
    "Index, income & international ETFs": ["QQQ", "DIA", "IWM", "IJH", "VTI", "EFA", "EEM", "VXUS", "VGK", "EWJ", "MCHI", "INDA",
                                          "SCHD", "VYM", "JEPI", "MTUM", "QUAL", "USMV"],
    "Commodity, crypto & bond ETFs": ["GLD", "SLV", "USO", "COPX", "DBC", "IBIT", "ETHA", "TLT", "IEF", "AGG", "HYG", "LQD"],
    "Sector ETFs": list(SECTOR_ETFS.values()),
}
EXTRA = [t for ts in EXTRA_GROUPS.values() for t in ts]
WATCHLIST = US + SG + EXTRA

SECTORS = {
    name: {"etf": etf, "stocks": [r["symbol"] for r in SP500 if r["sector"] == name]}
    for name, etf in SECTOR_ETFS.items()
}
SECTOR_TICKERS = sorted({t for s in SECTORS.values() for t in [s["etf"], *s["stocks"]]})

# Index feeds whose headlines are shown as "US market" news (context only; not part of any score).
MARKET_FEEDS = ["^GSPC", "^DJI", "^IXIC"]  # S&P 500, Dow, Nasdaq

_all = US + SG + EXTRA
assert len(_all) == len(set(_all)), f"duplicate tickers in the universe: {sorted({t for t in _all if _all.count(t) > 1})}"
assert not set(BENCHMARKS) & set(_all), "benchmarks (SPY, ES3.SI) are for comparison only and must not be ranked"
