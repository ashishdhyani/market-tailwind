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
