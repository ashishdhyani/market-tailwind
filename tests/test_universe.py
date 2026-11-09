import csv, io, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import universe

SECTORS = list(universe.SECTOR_NAMES)

def make(n=500, **overrides):
    out = io.StringIO(); w = csv.writer(out)
    w.writerow(["Symbol", "Security", "GICS Sector", "GICS Sub-Industry"])
    for i in range(n):
        w.writerow([f"T{i}", f"Company {i}", SECTORS[i % len(SECTORS)], "x"])
    return out.getvalue()

def rejects(text, why):
    try: universe.parse(text)
    except ValueError: return
    raise AssertionError("should have been rejected: " + why)

# good list parses, sorted, sectors renamed to the app's names
rows = universe.parse(make())
assert len(rows) == 500 and rows == sorted(rows, key=lambda r: r["symbol"])
assert {r["sector"] for r in rows} == set(universe.SECTOR_NAMES.values())
assert universe.SECTOR_NAMES["Information Technology"] == "Technology" and "Technology" in {r["sector"] for r in rows}

# Yahoo symbol form: class shares use a dash
t = make(500).replace("T1,", "BRK.B,", 1)
assert "BRK-B" in {r["symbol"] for r in universe.parse(t)}

# bad or truncated downloads are refused instead of replacing the good list
rejects(make(100), "too few rows (truncated download)")
rejects(make(700), "too many rows")
rejects(make().replace("Energy", "Crypto"), "unknown sector")
rejects(make().replace("T5,", "T4,", 1), "duplicate symbol")
rejects(make().replace("T7,", "<script>,", 1), "bad symbol")
rejects("<html>Not Found</html>", "an error page")
rejects("", "empty")

# round trip through the file format
import tempfile
with tempfile.TemporaryDirectory() as d:
    path = Path(d) / "x.csv"; universe.write(rows, path); assert universe.load(path) == rows

# the committed list is sane and is what the app uses
committed = universe.load()
syms = [r["symbol"] for r in committed]
assert 450 <= len(syms) <= 560 and len(set(syms)) == len(syms), len(syms)
assert {r["sector"] for r in committed} == set(universe.SECTOR_NAMES.values())
assert "AAPL" in syms and "BRK-B" in syms and "." not in "".join(syms)
import settings
assert settings.US == syms and set(settings.WATCHLIST) == set(syms) | set(settings.SG) | set(settings.EXTRA)
assert sum(len(v["stocks"]) for v in settings.SECTORS.values()) == len(syms)

# hand-picked groups: ETFs and quantum stocks. No overlaps with the index, SG, or the comparison benchmarks.
assert settings.EXTRA and len(set(settings.EXTRA)) == len(settings.EXTRA)
assert not set(settings.EXTRA) & set(syms) and not set(settings.EXTRA) & set(settings.SG)
assert not set(settings.EXTRA) & set(settings.BENCHMARKS), "SPY / ES3.SI are benchmarks, not ranked"
assert all(settings.EXTRA_GROUPS.values()), "empty group"
for t in ("AGIX", "AIPO", "QTUM"): assert t in settings.EXTRA, t           # asked for by name
for t in ("IONQ", "RGTI", "QBTS", "QUBT"): assert settings.EXTRA_GROUPS["Quantum computing"].count(t) == 1, t
assert "QMCO" not in settings.EXTRA, "QMCO is Quantum Corp (data storage), not quantum computing"
assert set(settings.EXTRA_GROUPS["Sector ETFs"]) == set(settings.SECTOR_ETFS.values())

# reference series (stand-ins for funds without prices of their own) are exported but never ranked or grouped
assert settings.REFERENCE == ["URTH", "BNDW"] and not set(settings.REFERENCE) & set(settings.WATCHLIST)
assert not set(settings.REFERENCE) & set(settings.BENCHMARKS)

# the exported groups mark exactly the hand-picked ones
import export_web
present = set(settings.WATCHLIST) | set(settings.SECTOR_ETFS.values())
groups = export_web.build_groups(present)
assert [g["name"] for g in groups if g.get("picked")] == ["Singapore", *settings.EXTRA_GROUPS]
assert all("etf" in g for g in groups if not g.get("picked")) and len(groups) == 11 + 1 + len(settings.EXTRA_GROUPS)
assert sorted(t for g in groups for t in g["tickers"]) == sorted(settings.WATCHLIST), "every ranked ticker is in exactly one group"
assert not any(t in settings.REFERENCE for g in groups for t in g["tickers"]), "reference series are not in any group"
print("universe: ALL OK")
