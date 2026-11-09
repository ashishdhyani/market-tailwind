"""Fetch a full report for ONE stock or ETF from Yahoo Finance and write it as JSON for the app's Lookup tab.

    python lookup.py SYMBOL out.json

The browser cannot call Yahoo directly (it blocks web pages), so the Lookup tab asks a GitHub job to run this script
and publish the result. Each section is fetched independently: if one fails the others still arrive, and the failure is
listed under "errors" so the page can say "not available" instead of showing nothing. Output is plain JSON with no
NaN/Infinity; strings are length-limited (the page escapes everything it shows, and never executes any of it).
"""
import json
import math
import re
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

import sentiment
from fundamentals import normalize

warnings.filterwarnings("ignore")

SYMBOL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}$")   # same rule in site/lookup.js and the workflow
YEARS = "5y"


def num(v, digits=6):
    """A plain float (or None): numpy numbers and pandas NaN/inf become None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else float(f"{f:.{digits}g}")


def text(v, limit=200):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = re.sub(r"[\u0000-\u001f\u007f]", " ", str(v)).strip()
    return s[:limit] or None


def iso(d):
    try:
        return d.date().isoformat() if hasattr(d, "date") else d.isoformat()
    except Exception:
        return None


def first_row(df, labels):
    """The first matching row label of a statement DataFrame (Yahoo renames lines now and then)."""
    for label in labels:
        if label in df.index:
            return df.loc[label]
    return None


INCOME = {"revenue": ["Total Revenue", "Operating Revenue"], "gross_profit": ["Gross Profit"], "operating_income": ["Operating Income"],
          "net_income": ["Net Income", "Net Income Common Stockholders"], "ebitda": ["EBITDA", "Normalized EBITDA"], "eps": ["Diluted EPS", "Basic EPS"]}
CASH = {"operating_cf": ["Operating Cash Flow"], "capex": ["Capital Expenditure"], "fcf": ["Free Cash Flow"]}
BALANCE = {"cash": ["Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents"], "debt": ["Total Debt"],
           "equity": ["Stockholders Equity", "Common Stock Equity"], "assets": ["Total Assets"]}


def statements(income, cash, balance, n):
    """Newest-first list of periods, each with the key lines from the three statements."""
    if income is None or getattr(income, "empty", True):
        return []
    out = []
    for col in sorted(income.columns, reverse=True)[:n]:
        row = {"period": iso(col), **{k: None for m in (INCOME, CASH, BALANCE) for k in m}}   # every line present, None when Yahoo lacks it
        for frame, mapping in ((income, INCOME), (cash, CASH), (balance, BALANCE)):
            if frame is None or getattr(frame, "empty", True) or col not in frame.columns:
                continue
            for key, labels in mapping.items():
                series = first_row(frame, labels)
                row[key] = num(series[col]) if series is not None else None
        out.append(row)
    return out


def section(errors, name, fn, default=None):
    try:
        return fn()
    except Exception as exc:  # a missing section must never sink the whole report
        errors[name] = f"{type(exc).__name__}: {str(exc)[:120]}"
        return default


def build(symbol: str) -> dict:
    sym = symbol.strip().upper()
    now = datetime.now(timezone.utc)
    out = {"version": 1, "symbol": sym, "fetched": now.strftime("%Y-%m-%d %H:%M UTC"), "fetched_ts": int(now.timestamp()), "found": False, "errors": {}}
    if not SYMBOL_RE.match(sym):
        out["error"] = "That does not look like a ticker symbol."
        return out
    errors = out["errors"]
    t = yf.Ticker(sym)
    info = section(errors, "info", lambda: t.info or {}, {})
    hist = section(errors, "prices", lambda: t.history(period=YEARS, auto_adjust=False), None)
    if hist is None or getattr(hist, "empty", True):
        out["error"] = f"Yahoo Finance has no price data for {sym}. Check the symbol (Singapore stocks end in .SI)."
        return out
    out["found"] = True

    hist = hist.dropna(subset=["Adj Close"])
    out["prices"] = {"dates": [iso(i) for i in hist.index], "close": [num(v) for v in hist["Adj Close"]], "volume": [num(v, 4) for v in hist["Volume"]]}
    out["profile"] = {
        "name": text(info.get("longName") or info.get("shortName") or sym), "exchange": text(info.get("fullExchangeName") or info.get("exchange")),
        "currency": text(info.get("currency")), "financial_currency": text(info.get("financialCurrency")), "type": text(info.get("quoteType")), "sector": text(info.get("sector")), "industry": text(info.get("industry")),
        "country": text(info.get("country")), "website": text(info.get("website"), 120), "employees": num(info.get("fullTimeEmployees")),
        "summary": text(info.get("longBusinessSummary"), 1400), "category": text(info.get("category")), "family": text(info.get("fundFamily")),
    }
    out["info"] = normalize(info)                       # the same fields and units as fundamentals.json, so the app reuses its checks
    keys = {"previous_close": "regularMarketPreviousClose", "day_low": "dayLow", "day_high": "dayHigh", "avg_volume": "averageVolume", "avg_volume_10d": "averageVolume10days",
            "float_shares": "floatShares", "shares_out": "sharesOutstanding", "short_pct_float": "shortPercentOfFloat", "shares_short": "sharesShort", "short_ratio": "shortRatio",
            "held_insiders": "heldPercentInsiders", "held_institutions": "heldPercentInstitutions", "book_value": "bookValue", "enterprise_value": "enterpriseValue",
            "total_cash": "totalCash", "total_debt": "totalDebt", "revenue": "totalRevenue", "gross_profit": "grossProfits", "ebitda": "ebitda", "operating_cf": "operatingCashflow",
            "price_to_sales": "priceToSalesTrailing12Months", "peg": "pegRatio", "payout": "payoutRatio", "div_rate": "dividendRate", "five_year_div_yield": "fiveYearAvgDividendYield",
            "current_ratio": "currentRatio", "quick_ratio": "quickRatio", "target_high": "targetHighPrice", "target_low": "targetLowPrice", "target_median": "targetMedianPrice",
            "price": "currentPrice", "nav": "navPrice", "net_assets": "netAssets", "ytd_return": "ytdReturn", "three_year_return": "threeYearAverageReturn", "five_year_return": "fiveYearAverageReturn"}
    out["extra"] = {k: num(info.get(v)) for k, v in keys.items() if num(info.get(v)) is not None}

    out["dividends"] = section(errors, "dividends", lambda: [[iso(i), num(v)] for i, v in t.dividends.tail(40).items()], [])
    out["splits"] = section(errors, "splits", lambda: [[iso(i), num(v)] for i, v in t.splits.tail(10).items()], [])
    out["financials"] = {
        "annual": section(errors, "annual statements", lambda: statements(t.income_stmt, t.cashflow, t.balance_sheet, 5), []),
        "quarterly": section(errors, "quarterly statements", lambda: statements(t.quarterly_income_stmt, t.quarterly_cashflow, t.quarterly_balance_sheet, 8), []),
    }

    def analysts():
        a = {"trend": [], "targets": {}, "changes": [], "estimates": {}}
        rec = t.recommendations
        if rec is not None and not rec.empty:
            a["trend"] = [{"period": text(r.get("period"), 8), **{k: num(r.get(k)) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}} for _, r in rec.head(4).iterrows()]
        a["targets"] = {k: num(v) for k, v in (t.analyst_price_targets or {}).items()}
        ud = t.upgrades_downgrades
        if ud is not None and not ud.empty:
            a["changes"] = [{"date": iso(i), "firm": text(r.get("Firm"), 60), "to": text(r.get("ToGrade"), 30), "from": text(r.get("FromGrade"), 30), "action": text(r.get("Action"), 20),
                             "target": num(r.get("currentPriceTarget"))} for i, r in ud.head(12).iterrows()]
        for name, frame in (("eps", t.earnings_estimate), ("revenue", t.revenue_estimate)):
            if frame is not None and not frame.empty:
                a["estimates"][name] = [{"period": text(i, 8), **{k: num(r.get(k)) for k in ("avg", "low", "high", "growth", "numberOfAnalysts")}} for i, r in frame.iterrows()]
        return a
    out["analysts"] = section(errors, "analysts", analysts, {})

    def earnings():
        ed = t.earnings_dates
        hist_rows = []
        if ed is not None and not ed.empty:
            for i, r in ed.iterrows():
                if num(r.get("Reported EPS")) is not None:
                    hist_rows.append({"date": iso(i), "estimate": num(r.get("EPS Estimate")), "actual": num(r.get("Reported EPS")), "surprise_pct": num(r.get("Surprise(%)"))})
        return {"history": hist_rows[:8]}
    out["earnings"] = section(errors, "earnings", earnings, {"history": []})

    def holders():
        h = {"top": []}
        inst = t.institutional_holders
        if inst is not None and not inst.empty:
            h["top"] = [{"holder": text(r.get("Holder"), 70), "pct": num(r.get("pctHeld")), "shares": num(r.get("Shares")), "value": num(r.get("Value")), "change": num(r.get("pctChange"))}
                        for _, r in inst.head(10).iterrows()]
        return h
    out["holders"] = section(errors, "holders", holders, {"top": []})

    def insiders():
        tx = t.insider_transactions
        if tx is None or tx.empty:
            return []
        col = "Start Date" if "Start Date" in tx.columns else None
        return [{"date": iso(r.get(col)) if col else None, "insider": text(r.get("Insider"), 50), "position": text(r.get("Position"), 40), "text": text(r.get("Text"), 120),
                 "shares": num(r.get("Shares")), "value": num(r.get("Value"))} for _, r in tx.head(12).iterrows()]
    out["insiders"] = section(errors, "insiders", insiders, [])

    def news():
        import news as feeds  # the app's existing Yahoo RSS reader
        items = []
        for a in sorted(feeds.fetch_feed(sym), key=lambda x: x["time"], reverse=True)[:15]:
            items.append({"title": text(a["title"], 200), "url": a["url"] if a["url"].startswith(("http://", "https://")) else None, "time": a["time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "summary": text(feeds.clean_summary(a["summary"]), 260), "score": round(sentiment.score(f"{a['title']}. {feeds.clean_summary(a['summary'], 2000)}"), 3)})
        return items
    out["news"] = section(errors, "news", news, [])
    return out


def main(argv) -> int:
    if len(argv) != 3:
        print("usage: python lookup.py SYMBOL out.json", file=sys.stderr)
        return 2
    result = build(argv[1])
    Path(argv[2]).write_text(json.dumps(result, separators=(",", ":"), allow_nan=False))
    print(f"{result['symbol']}: {'found' if result['found'] else 'not found'}, {Path(argv[2]).stat().st_size / 1e3:.0f} KB"
          + (f", missing sections: {', '.join(result['errors'])}" if result.get("errors") else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
