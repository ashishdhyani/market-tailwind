"""Run the original pandas code on site/data.json and dump results for tests/crosscheck.js to compare."""
import json, sys
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent.parent))
import backtest as bt, scoring

d = json.loads((Path(__file__).parent.parent / "site" / "data.json").read_text())
px = pd.DataFrame(d["prices"], index=pd.to_datetime(d["dates"]), dtype=float)
uni, bench = px[d["watchlist"]], px[list(d["benchmarks"])]
out = {}
table, asof = scoring.latest_table(uni)
out["table"] = {"asof": str(asof.date()), "rows": [[t, r["rank"], r["score"], r["price"], scoring.explain(r)] for t, r in table.iterrows()]}
for top_n, cost in [(5, 10), (8, 25)]:
    res = bt.run_backtest(uni, top_n=top_n, cost_bps=cost, benchmarks=bench)
    out[f"bt_{top_n}_{cost}"] = {
        "metrics": res["metrics"].to_dict("index"),
        "yearly": {k: v for k, v in res["yearly"].to_dict("list").items()},
        "end": {k: float(v) for k, v in res["equity"].iloc[-1].items()},
        "n": len(res["equity"]),
    }


# ---- short horizons: same pandas code, momentum swapped for an N-day return, other rebalance cadence ----
import numpy as np

def with_horizon(prices, days):
    f = scoring.compute_features(prices)
    ret = prices / prices.shift(days) - 1
    z = {"ret": scoring._z(ret), "trend": scoring._z(f["trend"]), "low_vol": -scoring._z(f["vol_63d"]),
         "near_high": scoring._z(f["drawdown_1y"])}
    return 0.55 * z["ret"] + 0.20 * z["trend"] + 0.15 * z["low_vol"] + 0.10 * z["near_high"]

def week_ends(index, every=1):
    s = index.to_series()
    iso = index.isocalendar()
    last = s.groupby([iso["year"].values, iso["week"].values]).last()
    d = pd.DatetimeIndex(sorted(last.values))
    return d[::every]

out["short"] = {}
for key, days, cadence in [("1m", 21, "month"), ("2w", 10, 2), ("1w", 5, 1)]:
    sc = with_horizon(uni, days)
    vd = sc.dropna(how="all").index[-1]
    s = sc.loc[vd].dropna().sort_values(ascending=False)
    entry = {"asof": str(vd.date()), "rank": list(s.index), "score": list(s.values)}
    orig = (bt.score_from_features, bt.rebalance_dates)
    bt.score_from_features = lambda f, sc=sc: sc
    if cadence != "month":
        bt.rebalance_dates = lambda idx, c=cadence: week_ends(idx, c)
    res = bt.run_backtest(uni, top_n=5, cost_bps=10, benchmarks=bench)
    bt.score_from_features, bt.rebalance_dates = orig
    entry["metrics"] = res["metrics"].to_dict("index"); entry["n"] = len(res["equity"])
    entry["end"] = {k: float(v) for k, v in res["equity"].iloc[-1].items()}
    out["short"][key] = entry
print(json.dumps(out, default=float))
