"""Project settings: where data lives and which stocks to analyze."""
from pathlib import Path

ROOT = Path(__file__).parent
DB_PATH = ROOT / "data" / "market.db"
START_DATE = "2012-01-01"

# Edit freely. Yahoo Finance symbols: US = plain ticker, Singapore = ".SI" suffix.
US = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "AVGO", "JPM", "V", "MA",
    "LLY", "UNH", "XOM", "CVX", "PG", "KO", "PEP", "COST", "WMT", "HD",
    "JNJ", "MRK", "ABBV", "CSCO", "ORCL", "ADBE", "NFLX", "CRM", "TXN", "CAT",
]
SG = [
    "D05.SI", "O39.SI", "U11.SI",  # DBS, OCBC, UOB
    "Z74.SI", "C6L.SI", "S63.SI",  # Singtel, SIA, ST Engineering
    "C38U.SI", "A17U.SI",          # CapitaLand Integrated Commercial Trust, CapitaLand Ascendas REIT
    "F34.SI", "BN4.SI", "Y92.SI", "C07.SI", "G13.SI", "U96.SI", "S68.SI",
]
WATCHLIST = US + SG

# Used only for comparison in the backtest, never ranked or picked.
BENCHMARKS = {"SPY": "S&P 500 ETF", "ES3.SI": "STI ETF (Singapore)"}

# US sectors for the "Sectors & News" view: one SPDR sector ETF plus large US stocks each.
# US-listed only. Edit freely; the daily job picks up changes.
SECTORS = {
    "Technology":             {"etf": "XLK",  "stocks": ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM"]},
    "Communication Services": {"etf": "XLC",  "stocks": ["GOOGL", "META", "NFLX", "DIS", "TMUS", "VZ"]},
    "Consumer Discretionary": {"etf": "XLY",  "stocks": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW"]},
    "Consumer Staples":       {"etf": "XLP",  "stocks": ["PG", "KO", "PEP", "COST", "WMT", "PM"]},
    "Energy":                 {"etf": "XLE",  "stocks": ["XOM", "CVX", "COP", "EOG", "SLB", "OXY"]},
    "Financials":             {"etf": "XLF",  "stocks": ["JPM", "BAC", "WFC", "GS", "V", "MA"]},
    "Health Care":            {"etf": "XLV",  "stocks": ["LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO"]},
    "Industrials":            {"etf": "XLI",  "stocks": ["CAT", "GE", "RTX", "HON", "UNP", "DE"]},
    "Materials":              {"etf": "XLB",  "stocks": ["LIN", "SHW", "FCX", "APD", "ECL", "NEM"]},
    "Real Estate":            {"etf": "XLRE", "stocks": ["PLD", "AMT", "EQIX", "WELL", "SPG", "O"]},
    "Utilities":              {"etf": "XLU",  "stocks": ["NEE", "SO", "DUK", "CEG", "AEP", "SRE"]},
}
SECTOR_TICKERS = sorted({t for s in SECTORS.values() for t in [s["etf"], *s["stocks"]]})
