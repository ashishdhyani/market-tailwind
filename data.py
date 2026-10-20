"""Download daily prices from Yahoo Finance (free) and keep them in a local SQLite file.

Run `python data.py` to refresh everything. The app reads only from SQLite, so you
download once and never hit rate limits while experimenting.
"""
import sqlite3
import time

import pandas as pd
import yfinance as yf

from settings import BENCHMARKS, DB_PATH, SECTOR_TICKERS, START_DATE, WATCHLIST

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT NOT NULL, date TEXT NOT NULL,
    open REAL, high REAL, low REAL, close REAL, adj_close REAL, volume REAL,
    PRIMARY KEY (ticker, date)
)
"""
FIELDS = {"open", "high", "low", "close", "adj_close", "volume"}


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(SCHEMA)
    return conn


def fetch(ticker: str, start: str = START_DATE) -> pd.DataFrame:
    """Full daily history. Re-downloaded in full each time because dividends and
    splits retroactively change adjusted prices."""
    df = yf.Ticker(ticker).history(start=start, auto_adjust=False, actions=False)
    if df.empty:
        return df
    df = df.rename(columns=str.lower).rename(columns={"adj close": "adj_close"})
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df = df[["open", "high", "low", "close", "adj_close", "volume"]]
    return df.dropna(subset=["adj_close"]).astype(float)


def update(tickers=None, pause: float = 0.5):
    """Refresh tickers (default: watchlist + benchmarks). Returns (ok, failed)."""
    tickers = list(tickers) if tickers else sorted(set(WATCHLIST) | set(BENCHMARKS) | set(SECTOR_TICKERS))
    conn = connect()
    ok, failed = [], []
    for t in tickers:
        try:
            df = fetch(t)
            if df.empty:
                failed.append(f"{t} (no data)")
                continue
            rows = [
                (t, d.strftime("%Y-%m-%d"), *vals)
                for d, vals in zip(df.index, df.itertuples(index=False, name=None))
            ]
            with conn:
                conn.execute("DELETE FROM prices WHERE ticker = ?", (t,))
                conn.executemany("INSERT INTO prices VALUES (?,?,?,?,?,?,?,?)", rows)
            ok.append(t)
        except Exception as exc:  # network hiccup, bad symbol, etc.
            failed.append(f"{t} ({type(exc).__name__})")
        time.sleep(pause)
    conn.close()
    return ok, failed


def load_prices(tickers=None, field: str = "adj_close") -> pd.DataFrame:
    """Wide table: one column per ticker, indexed by date."""
    if field not in FIELDS:
        raise ValueError(f"field must be one of {sorted(FIELDS)}")
    conn = connect()
    df = pd.read_sql_query(f"SELECT ticker, date, {field} AS v FROM prices", conn, parse_dates=["date"])
    conn.close()
    if df.empty:
        return pd.DataFrame()
    wide = df.pivot(index="date", columns="ticker", values="v").sort_index()
    if tickers:
        wide = wide[[t for t in tickers if t in wide.columns]]
    # Markets close on different holidays; carry the last price a few days.
    return wide.ffill(limit=5)


if __name__ == "__main__":
    ok, failed = update()
    print(f"Updated {len(ok)} tickers.")
    if failed:
        print("Failed:", ", ".join(failed))
