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
print(json.dumps(out, default=float))
