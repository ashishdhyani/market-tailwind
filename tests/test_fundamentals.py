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
print("fundamentals normalize: ALL OK")
