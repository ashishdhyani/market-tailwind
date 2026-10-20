"""Monthly-rebalanced backtest of the composite score.

Guards against look-ahead bias: the signal uses the close of the last trading day
of the month, and the trade is filled `lag` extra trading days later (default 1 = the
next day's close). Costs are charged on every change in position.
"""
import numpy as np
import pandas as pd

from scoring import compute_features, score_from_features

TRADING_DAYS = 252


def rebalance_dates(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    last_per_month = index.to_series().groupby(index.to_period("M")).last()
    return pd.DatetimeIndex(last_per_month.values)


def _simulate(target: pd.DataFrame, rets: pd.DataFrame, cost_bps: float, lag: int):
    """target: weights decided at rebalance dates (NaN elsewhere)."""
    pos = target.ffill().fillna(0.0).shift(1 + lag).fillna(0.0)
    turnover = pos.diff().abs().sum(axis=1)
    turnover.iloc[0] = pos.iloc[0].abs().sum()
    net = (pos * rets).sum(axis=1) - turnover * cost_bps / 1e4
    live = pos.abs().sum(axis=1) > 0
    if not live.any():
        raise ValueError("No trades were generated; need more price history.")
    start = live.idxmax()
    return net.loc[start:], turnover.loc[start:]


def perf_stats(r: pd.Series) -> dict:
    r = r.dropna()
    eq = (1 + r).cumprod()
    years = len(r) / TRADING_DAYS
    vol = r.std() * np.sqrt(TRADING_DAYS)
    return {
        "Total return": eq.iloc[-1] - 1,
        "CAGR": eq.iloc[-1] ** (1 / years) - 1 if years > 0 else np.nan,
        "Volatility": vol,
        "Sharpe": (r.mean() * TRADING_DAYS) / vol if vol > 0 else np.nan,
        "Max drawdown": (eq / eq.cummax() - 1).min(),
    }


def run_backtest(prices, top_n=5, cost_bps=10.0, lag=1, benchmarks=None) -> dict:
    prices = prices.dropna(axis=1, how="all")
    rets = prices.pct_change().fillna(0.0)
    score = score_from_features(compute_features(prices))
    cols = prices.columns

    tgt_top = pd.DataFrame(np.nan, index=prices.index, columns=cols)
    tgt_all = tgt_top.copy()
    for d in rebalance_dates(prices.index):
        s = score.loc[d].dropna()
        if len(s) < max(top_n, 2):
            continue
        w = pd.Series(0.0, index=cols)
        w[s.nlargest(top_n).index] = 1.0 / top_n
        tgt_top.loc[d] = w
        a = pd.Series(0.0, index=cols)
        a[s.index] = 1.0 / len(s)
        tgt_all.loc[d] = a

    strat, turnover = _simulate(tgt_top, rets, cost_bps, lag)
    ew, _ = _simulate(tgt_all, rets, cost_bps, lag)
    series = {f"Top {top_n} by score": strat, "Equal-weight universe": ew.loc[strat.index[0]:]}

    if benchmarks is not None and not benchmarks.empty:
        b_aligned = benchmarks.ffill().reindex(strat.index, method="ffill")
        for c in b_aligned.columns:
            series[f"{c} (buy & hold)"] = b_aligned[c].pct_change().fillna(0.0)

    equity = pd.DataFrame({k: (1 + v).cumprod() for k, v in series.items()})
    metrics = pd.DataFrame({k: perf_stats(v) for k, v in series.items()}).T
    yearly = pd.DataFrame({k: (1 + v).groupby(v.index.year).prod() - 1 for k, v in series.items()})
    years = len(strat) / TRADING_DAYS
    metrics.loc[f"Top {top_n} by score", "Annual turnover"] = turnover.sum() / 2 / years
    return {"equity": equity, "metrics": metrics, "yearly": yearly}


if __name__ == "__main__":
    from data import load_prices
    from settings import BENCHMARKS, WATCHLIST

    allp = load_prices()
    uni = allp[[t for t in WATCHLIST if t in allp.columns]]
    bench = allp[[b for b in BENCHMARKS if b in allp.columns]]
    res = run_backtest(uni, benchmarks=bench)
    pd.options.display.float_format = "{:.3f}".format
    print(res["metrics"])
