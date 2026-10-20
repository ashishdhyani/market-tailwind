"""Streamlit dashboard. Run with: streamlit run app.py"""
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import backtest as bt
import data
import scoring
from settings import BENCHMARKS, WATCHLIST

st.set_page_config(page_title="Investment Ideas Lab", layout="wide")
st.title("Investment Ideas Lab")
st.caption("Free-data prototype: momentum + trend + risk ranking, checked with a backtest. "
           "A research tool, not financial advice.")


@st.cache_data(show_spinner=False)
def load_prices():
    return data.load_prices()


@st.cache_data(show_spinner="Running backtest...")
def run_bt(prices, bench, top_n, cost_bps):
    return bt.run_backtest(prices, top_n=top_n, cost_bps=cost_bps, benchmarks=bench)


with st.sidebar:
    st.header("Controls")
    if st.button("Update price data"):
        with st.spinner("Downloading from Yahoo Finance..."):
            ok, failed = data.update()
        st.cache_data.clear()
        st.success(f"Updated {len(ok)} tickers")
        if failed:
            st.warning("Failed: " + ", ".join(failed))

prices_all = load_prices()
if prices_all.empty:
    st.info("No data yet. Click **Update price data** in the sidebar (takes about a minute).")
    st.stop()

options = [t for t in WATCHLIST if t in prices_all.columns]
with st.sidebar:
    universe = st.multiselect("Universe", options, default=options)
    top_n = st.slider("Number of picks (top N)", 3, 15, 5)
    cost_bps = st.slider("Trading cost per side (bps)", 0, 50, 10)

if len(universe) < 6:
    st.warning("Select at least 6 stocks.")
    st.stop()

prices = prices_all[universe]
bench = prices_all[[b for b in BENCHMARKS if b in prices_all.columns]]

tab_rank, tab_chart, tab_bt, tab_about = st.tabs(["Rankings", "Chart", "Backtest", "About"])

with tab_rank:
    try:
        table, asof = scoring.latest_table(prices)
    except ValueError as exc:
        st.error(str(exc))
        st.stop()
    st.subheader(f"Top {top_n} ideas as of {asof:%d %b %Y}")
    for t, row in table.head(top_n).iterrows():
        st.markdown(f"**{int(row['rank'])}. {t}**: {scoring.explain(row)}")
    show = table[["rank", "price", "score", "mom_12_1", "mom_6_1", "trend_label", "vol_63d", "drawdown_1y"]].copy()
    for c in ["mom_12_1", "mom_6_1", "vol_63d", "drawdown_1y"]:
        show[c] = show[c] * 100
    st.dataframe(
        show,
        column_config={
            "score": st.column_config.NumberColumn("Score", format="%.2f"),
            "price": st.column_config.NumberColumn("Price", format="%.2f"),
            "mom_12_1": st.column_config.NumberColumn("12-1m momentum", format="%.1f%%"),
            "mom_6_1": st.column_config.NumberColumn("6-1m momentum", format="%.1f%%"),
            "trend_label": "Trend",
            "vol_63d": st.column_config.NumberColumn("Volatility (ann.)", format="%.1f%%"),
            "drawdown_1y": st.column_config.NumberColumn("From 1y high", format="%.1f%%"),
        },
    )
    st.caption("Prices are in each stock's local currency (USD / SGD). The score only ranks stocks "
               "against each other; it does not say any of them is a good buy.")

with tab_chart:
    ticker = st.selectbox("Ticker", list(table.index))
    full = prices[ticker].dropna()
    view = full.index >= full.index[-1] - pd.Timedelta(days=730)
    fig = go.Figure()
    fig.add_scatter(x=full.index[view], y=full[view], name="Price")
    fig.add_scatter(x=full.index[view], y=full.rolling(50).mean()[view], name="50d avg")
    fig.add_scatter(x=full.index[view], y=full.rolling(200).mean()[view], name="200d avg")
    fig.update_layout(height=450, margin=dict(l=10, r=10, t=30, b=10), hovermode="x unified")
    st.plotly_chart(fig)

with tab_bt:
    res = run_bt(prices, bench, top_n, cost_bps)
    fig = go.Figure()
    for col in res["equity"].columns:
        fig.add_scatter(x=res["equity"].index, y=res["equity"][col], name=col)
    fig.update_layout(height=450, yaxis_type="log", yaxis_title="Growth of 1 (log scale)",
                      margin=dict(l=10, r=10, t=30, b=10), hovermode="x unified")
    st.plotly_chart(fig)
    st.subheader("Performance")
    st.dataframe(res["metrics"].style.format({
        "Total return": "{:.1%}", "CAGR": "{:.1%}", "Volatility": "{:.1%}",
        "Sharpe": "{:.2f}", "Max drawdown": "{:.1%}", "Annual turnover": "{:.0%}"}, na_rep=""))
    st.subheader("Calendar-year returns")
    st.dataframe(res["yearly"].style.format("{:.1%}"))
    with st.expander("Read before trusting these numbers"):
        st.markdown(
            "- **Survivorship bias:** the watchlist is today's large, successful companies, "
            "so past results look better than a real investor could have achieved.\n"
            "- **Costs are simplified:** flat basis points per side, no taxes, no slippage.\n"
            "- **Mixed currencies:** US and SG stocks are ranked on local-currency returns.\n"
            "- **Few years, few stocks:** differences of a few percent are noise.\n"
            "- A good backtest does not predict future returns."
        )

with tab_about:
    st.markdown(
        "**How the score works:** each stock is ranked against the others on 12-1 month momentum (35%), "
        "6-1 month momentum (20%), trend vs. 50/200-day averages (20%), low volatility (15%) and "
        "closeness to the 1-year high (10%).\n\n"
        "**Next steps:** add fundamentals (SEC EDGAR), news sentiment (Finnhub free tier + FinBERT) "
        "and macro data (FRED) as extra features, then re-run the backtest to see if they help."
    )
