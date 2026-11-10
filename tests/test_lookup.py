"""lookup.py: the pure helpers, input validation (no network), and the real fixtures it produced."""
import json, math, sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import lookup as K

ok = 0
def check(c, m):
    global ok
    assert c, m
    ok += 1

# num / text / iso
check(K.num(float("nan")) is None and K.num(float("inf")) is None and K.num(None) is None and K.num("x") is None, "non-finite numbers become None")
check(K.num(1.23456789) == 1.23457 and K.num(0.000012345678) == 1.23457e-05 and K.num(10**13) == 1e13, "six significant digits")
check(isinstance(K.num(__import__("numpy").float64(2.5)), float), "numpy numbers become plain floats")
check(K.text("a\x00b\x1fc\n d") == "a b c  d" or K.text("a\x00b\x1fc\n d").replace("  ", " ") == "a b c d", "control characters removed")
check(K.text("x" * 500, 50) == "x" * 50 and K.text(None) is None and K.text(float("nan")) is None and K.text("   ") is None, "text limits and blanks")
check(K.iso(pd.Timestamp("2026-11-06 09:30", tz="America/New_York")) == "2026-11-06", "timestamps become dates")

# symbol validation happens before any network call
for bad in ["", "../x", "bad symbol!", "A" * 13, "^GSPC", "-X", "a;b", "$(x)"]:
    r = K.build(bad)
    check(r["found"] is False and "ticker" in r["error"], f"rejected {bad!r}")
json.dumps(r, allow_nan=False)

# statements: row-name fallbacks, newest first, missing lines are None
cols = [pd.Timestamp("2025-12-31"), pd.Timestamp("2024-12-31")]
inc = pd.DataFrame({cols[0]: [150.0, 15.0, 0.4], cols[1]: [120.0, 10.0, 0.3]}, index=["Total Revenue", "Net Income", "Diluted EPS"])
cash = pd.DataFrame({cols[0]: [10.0], cols[1]: [float("nan")]}, index=["Free Cash Flow"])
rows = K.statements(inc, cash, None, 5)
check([r["period"] for r in rows] == ["2025-12-31", "2024-12-31"], "newest first")
check(rows[0]["revenue"] == 150 and rows[0]["net_income"] == 15 and rows[0]["eps"] == 0.4 and rows[0]["fcf"] == 10, "values mapped")
check(rows[1]["fcf"] is None and rows[0]["gross_profit"] is None and rows[0]["cash"] is None, "missing lines are None")
check(K.statements(None, None, None, 5) == [] and K.statements(pd.DataFrame(), None, None, 5) == [], "no statements -> []")
alt = pd.DataFrame({cols[0]: [7.0]}, index=["Operating Revenue"])
check(K.statements(alt, None, None, 5)[0]["revenue"] == 7, "alternate row name")

# a failing section is recorded, not fatal
errs = {}
check(K.section(errs, "x", lambda: 1 / 0, "dflt") == "dflt" and "ZeroDivisionError" in errs["x"], "section failure captured")
check(K.section(errs, "y", lambda: 5) == 5 and "y" not in errs, "section success passes through")

# the real files it produced: strict JSON, required shape, sane values
fx = Path(__file__).parent / "fixtures"
for n in ["SOFI", "TSM", "QQQM"]:
    raw = (fx / f"lookup_{n}_.json").read_text()
    d = json.loads(raw, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))   # NaN/Infinity would raise
    check(d["version"] == 1 and d["found"] and d["symbol"] == n and d["fetched_ts"] > 1.7e9, f"{n} header")
    p = d["prices"]
    check(len(p["dates"]) == len(p["close"]) == len(p["volume"]) > 1000 and p["dates"] == sorted(set(p["dates"])), f"{n} prices aligned and ascending")
    check(all(isinstance(v, float) and v > 0 for v in p["close"]), f"{n} closes positive")
    check(len(raw) < 200_000, f"{n} small enough to serve quickly")
# options: contract rows and chain selection
frame = pd.DataFrame({"strike": [5.0, 90.0, 100.0, 110.0, 400.0, 100.0], "lastPrice": [1, 12, 5, 1.5, 0.1, 4], "bid": [0, 11.5, 4.9, 1.4, 0, 0], "ask": [0, 12.5, 5.1, 1.6, 0, 0],
                      "volume": [10, 5, float("nan"), 0, 50, 7], "openInterest": [1, 0, 300, 0, 9, float("nan")], "impliedVolatility": [0.5] * 6,
                      "lastTradeDate": [pd.Timestamp("2026-11-09", tz="UTC")] * 6})
rows = K.contract_rows(frame, 40.0, 160.0)
check([r[0] for r in rows] == [90.0, 100.0, 100.0], f"strikes outside the band and contracts nobody trades or holds are dropped: {[r[0] for r in rows]}")
check(rows[0] == [90.0, 12.0, 11.5, 12.5, 5.0, 0.0, 0.5, "2026-11-09"], "row layout: strike, last, bid, ask, volume, open interest, iv, date")
check(rows[1][4] is None and rows[1][5] == 300.0 and rows[2][5] is None, "NaN volume/open interest become None")
check(all(len(r) == 8 for r in rows), "eight fields per row")

class FakeChain:
    def __init__(self, c, p): self.calls, self.puts = c, p
class FakeTicker:
    def __init__(self, dates, fail=()): self.options, self.fail = dates, fail
    def option_chain(self, d):
        if d in self.fail: raise RuntimeError("boom")
        return FakeChain(frame, frame)
from datetime import date as _d
today = _d(2026, 11, 9)
check(K.options_chains(FakeTicker(()), 100.0, today) is None, "no listed options -> None")
res = K.options_chains(FakeTicker(("2026-11-13", "2026-12-18", "2027-06-18")), 100.0, today)
check([e["date"] for e in res["expiries"]] == ["2026-11-13", "2026-12-18", "2027-06-18"] and res["spot"] == 100.0, "near expiries plus one far one kept")
res = K.options_chains(FakeTicker(("2026-11-13", "2026-12-18"), fail=("2026-11-13",)), 100.0, today)
check([e["date"] for e in res["expiries"]] == ["2026-12-18"], "a failing expiry is skipped, the rest kept")
many = tuple((_d(2026, 11, 10) + __import__("datetime").timedelta(days=i)).isoformat() for i in range(60))
check(len(K.options_chains(FakeTicker(many), 100.0, today)["expiries"]) == K.MAX_EXPIRIES - 1, "expiry count capped")
for n in ["SOFI", "TSM", "QQQM"]:
    o = json.loads((fx / f"lookup_{n}_.json").read_text())["options"]
    check(o and o["spot"] > 0 and len(o["expiries"]) >= 3 and all(len(r) == 8 for e in o["expiries"] for r in e["calls"] + e["puts"]), f"{n} options shape")
    check(any((r[4] or 0) > 0 for e in o["expiries"] for r in e["calls"]), f"{n} has traded contracts")
check(json.loads((fx / "lookup_TSM_.json").read_text())["profile"]["financial_currency"] == "TWD", "ADR reporting currency captured")
nf = json.loads((fx / "lookup_BADSYM123_.json").read_text())
check(nf["found"] is False and "prices" not in nf, "not-found result is tiny and flagged")
print(f"lookup.py: all {ok} checks passed")
