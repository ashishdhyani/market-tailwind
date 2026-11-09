import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from fundamentals import normalize

def approx(a, b): return abs(a - b) < 1e-9 * max(1, abs(b))

# Equity: percent-style fields get normalised, junk dropped
e = normalize({"longName": "Acme Corp", "quoteType": "EQUITY", "sector": "Energy", "currentPrice": 100.0,
               "dividendRate": 2.0, "dividendYield": 2.0,       # Yahoo's % field must NOT be used
               "debtToEquity": 78.445, "forwardPE": 14.66, "trailingPE": float("nan"), "marketCap": 7.3e11,
               "returnOnEquity": 0.1258, "earningsGrowth": None, "earningsQuarterlyGrowth": 0.5, "pegRatio": 1.55})
assert e["name"] == "Acme Corp" and e["sector"] == "Energy"
assert approx(e["de"], 0.78445), e["de"]
assert approx(e["div_yield"], 0.02), e["div_yield"]
assert "pe" not in e                           # NaN dropped
assert approx(e["earn_growth"], 0.5)           # falls back to quarterly growth
assert approx(e["peg"], 1.55)
assert e["fwd_pe"] == 14.66 and e["roe"] == 0.1258

# ETF: expense ratio and yield are percent in Yahoo
f = normalize({"longName": "Sector ETF", "quoteType": "ETF", "navPrice": 67.8, "netExpenseRatio": 0.08,
               "dividendYield": 2.48, "netAssets": 3.9e10, "category": "Equity Energy"})
assert approx(f["expense"], 0.0008) and approx(f["div_yield"], 0.0248), f
assert f["category"] == "Equity Energy" and "fwd_pe" not in f

# Empty / hostile input does not crash
assert normalize({}) == {}
assert normalize({"longName": "X", "forwardPE": "n/a", "marketCap": float("inf")}) == {"name": "X"}
# event dates: the earliest date that has not passed; past dates (Yahoo often reports the LAST earnings) are ignored
from datetime import date, datetime, timezone
ts = lambda iso: int(datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp())
today = date(2026, 11, 9)
ev = normalize({"longName": "X", "earningsTimestamp": ts("2026-11-02"), "earningsTimestampStart": ts("2027-01-28"),
                "earningsTimestampEnd": ts("2027-01-30"), "exDividendDate": ts("2026-11-12")}, today)
assert ev["next_earnings"] == "2027-01-28" and ev["ex_div"] == "2026-11-12", ev       # skips the 2 Nov report
assert normalize({"longName": "X", "earningsTimestamp": ts("2026-11-17")}, today)["next_earnings"] == "2026-11-17"
assert normalize({"longName": "X", "earningsTimestamp": ts("2026-11-09")}, today)["next_earnings"] == "2026-11-09"   # today counts
assert "next_earnings" not in normalize({"longName": "X", "earningsTimestamp": ts("2026-11-05")}, today)           # all past: none
assert "ex_div" not in normalize({"longName": "X", "exDividendDate": ts("2026-09-10")}, today)
assert "next_earnings" not in normalize({"longName": "X", "earningsTimestamp": ts("2031-01-01")}, today)            # absurdly far: ignored
assert "next_earnings" not in normalize({"longName": "X", "earningsTimestamp": "soon", "earningsTimestampStart": float("nan")}, today)
assert "next_earnings" not in normalize({"longName": "X", "quoteType": "ETF"}, today)                                # funds have none

# the daily refresh is skipped only when the file is recent AND already covers every ticker
from fundamentals import should_skip
have = {"AAPL": {}, "XOM": {}}
assert should_skip(5, 20, ["AAPL", "XOM"], have) is True
assert should_skip(25, 20, ["AAPL", "XOM"], have) is False            # too old
assert should_skip(5, 20, ["AAPL", "XOM", "AGIX"], have) is False     # a new ticker was added -> refresh now
assert should_skip(None, 20, ["AAPL"], have) is False                 # no file / unreadable
assert should_skip(5, 20, [], {}) is True
print("fundamentals normalize: ALL OK")
