"""Feature engineering and the composite score.

Score = weighted average of cross-sectional z-scores (each stock vs. the others on
the same day), so it only says "better or worse than the rest of the universe".
"""
import numpy as np
import pandas as pd

WEIGHTS = {
    "mom_12_1": 0.35,   # 12-month return, skipping the latest month
    "mom_6_1": 0.20,    # 6-month return, skipping the latest month
    "trend": 0.20,      # price vs 200d average, 50d vs 200d average
    "low_vol": 0.15,    # lower 63-day volatility is better
    "near_high": 0.10,  # closer to the 1-year high is better
}


def compute_features(prices: pd.DataFrame) -> dict:
    """Features for every date. Each value at date t uses only data up to t."""
    ret = prices.pct_change()
    sma50 = prices.rolling(50).mean()
    sma200 = prices.rolling(200).mean()
    valid = sma200.notna() & prices.notna()
    trend = ((prices > sma200).astype(float) + (sma50 > sma200).astype(float)).where(valid)
    return {
        "mom_12_1": prices.shift(21) / prices.shift(252) - 1,
        "mom_6_1": prices.shift(21) / prices.shift(126) - 1,
        "trend": trend,
        "vol_63d": ret.rolling(63).std() * np.sqrt(252),
        "drawdown_1y": prices / prices.rolling(252).max() - 1,
    }


def _z(df: pd.DataFrame) -> pd.DataFrame:
    std = df.std(axis=1).replace(0, np.nan)
    z = df.sub(df.mean(axis=1), axis=0).div(std, axis=0)
    z = z.mask(df.notna() & z.isna(), 0.0)  # all-equal day -> neutral, not missing
    return z.clip(-3, 3)


def score_from_features(f: dict) -> pd.DataFrame:
    z = {
        "mom_12_1": _z(f["mom_12_1"]),
        "mom_6_1": _z(f["mom_6_1"]),
        "trend": _z(f["trend"]),
        "low_vol": -_z(f["vol_63d"]),
        "near_high": _z(f["drawdown_1y"]),
    }
    return sum(WEIGHTS[k] * z[k] for k in WEIGHTS)


def latest_table(prices: pd.DataFrame):
    """Ranked snapshot as of the most recent date. Returns (table, as_of_date)."""
    f = compute_features(prices)
    score = score_from_features(f)
    valid_days = score.dropna(how="all").index
    if len(valid_days) == 0:
        raise ValueError("Not enough price history yet (need about 1 year per stock).")
    d = valid_days[-1]
    out = pd.DataFrame({k: v.loc[d] for k, v in f.items()})
    out["score"] = score.loc[d]
    out["price"] = prices.loc[d]
    out = out.dropna(subset=["score"]).sort_values("score", ascending=False)
    out.insert(0, "rank", range(1, len(out) + 1))
    out["trend_label"] = out["trend"].map({2.0: "Strong uptrend", 1.0: "Mixed trend", 0.0: "Downtrend"})
    return out, d


def explain(row) -> str:
    """One-line reason behind a pick."""
    return (
        f"12-1m momentum {row.mom_12_1:+.0%}, 6-1m {row.mom_6_1:+.0%}; "
        f"{row.trend_label.lower()}; volatility {row.vol_63d:.0%}; "
        f"{row.drawdown_1y:.0%} from 1-year high"
    )
