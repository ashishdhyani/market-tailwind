"""Independent Python calculation of the sector view, for tests/crosscheck_sectors.js to compare against."""
import json, math, sys
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
import scoring

sd = json.loads((ROOT / "site" / "sector_data.json").read_text())
news = json.loads((ROOT / "site" / "news.json").read_text())
px = pd.DataFrame(sd["prices"], index=pd.to_datetime(sd["dates"]), dtype=float)
etfs = {name: s["etf"] for name, s in sd["sectors"].items()}
table, _ = scoring.latest_table(px[list(etfs.values())])  # long-term price score, original pandas code

gen = datetime.strptime(news["generated"], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
def tone(tickers):
    n = sw = sws = 0.0
    for it in news["items"]:
        if not set(it["tickers"]) & tickers: continue
        t = datetime.strptime(it["time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        age = max(0.0, (gen - t).total_seconds() / 86400)
        if age > 7: continue
        w = 0.5 ** (age / 3); n += 1; sw += w; sws += w * it["score"]
    return n, (sws / sw if sw else 0.0)

out = {}
raw = {}
for name, s in sd["sectors"].items():
    n, avg = tone({s["etf"], *s["stocks"]})
    raw[name] = n, avg
    out[name] = {"price": float(table.loc[s["etf"], "score"]), "n": n, "avg": avg}
shr = [avg * n / (n + 3) for n, avg in raw.values()]
m = sum(shr) / len(shr); sdv = math.sqrt(sum((x - m) ** 2 for x in shr) / (len(shr) - 1))
for (name, _), v in zip(raw.items(), shr):
    out[name]["newsZ"] = (v - m) / sdv
    out[name]["final"] = 0.7 * out[name]["price"] + 0.3 * out[name]["newsZ"]
print(json.dumps(out))
