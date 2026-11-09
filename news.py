"""Download recent headlines for every sector ETF / stock from Yahoo Finance's public RSS feeds,
score their tone, and write site/news.json.

    python news.py

Headlines are untrusted text: we keep the title, a short plain-text blurb, a link, a timestamp and our
own score, and the web page escapes everything it shows. Nothing is written if too few feeds could be read, so a
blocked run keeps yesterday's file.
"""
import html
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import certifi

import sentiment
from concurrent.futures import ThreadPoolExecutor

from settings import EXTRA, MARKET_FEEDS, SECTOR_ETFS, SECTOR_TICKERS

OUT = Path(__file__).parent / "site" / "news.json"
NEWS_TICKERS = sorted(set(SECTOR_TICKERS) | set(EXTRA))   # S&P 500 + sector ETFs, plus the ETFs and quantum names
FEED = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={}&region=US&lang=en-US"
KEEP_DAYS = 10
PER_STOCK = 5      # ~500 stocks: a few headlines each keeps news.json small
PER_ETF = 15       # sector ETFs and market feeds carry the sector-level picture
SUMMARY_CHARS = 220
WORKERS = 4
MIN_FEEDS_OK = 0.8  # fraction of tickers that must load
# Some Python builds (e.g. python.org on macOS) ship without a CA bundle; certifi always has one.
CONTEXT = ssl.create_default_context(cafile=certifi.where())


def clean_summary(text: str, limit: int = SUMMARY_CHARS) -> str:
    """Plain-text blurb: no tags/entities, collapsed whitespace, cut on a word boundary."""
    text = re.sub(r"<[^>]*>", " ", html.unescape(text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:-– ")
    return cut + "…"


def fetch_feed(ticker: str, timeout: float = 20):
    req = urllib.request.Request(FEED.format(urllib.parse.quote(ticker)), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=CONTEXT) as resp:
        root = ET.fromstring(resp.read())
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = item.findtext("pubDate")
        if not title or not link.startswith(("http://", "https://")) or not pub:
            continue
        try:
            when = parsedate_to_datetime(pub).astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        yield {"title": title, "url": link, "time": when, "summary": (item.findtext("description") or "").strip()}


def collect(tickers, market=(), pause: float = 0.1):
    """Merge feeds into one list of articles; an article seen under several tickers is stored once.
    Items from `market` feeds (index feeds) are flagged so the app can show a "US market" view."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    articles, ok, failed = {}, 0, []
    etfs = set(SECTOR_ETFS.values())
    names = [*tickers, *market]

    def load(t):
        time.sleep(pause)
        limit = PER_ETF if (t in etfs or t in market) else PER_STOCK
        try:
            return t, sorted(fetch_feed(t), key=lambda a: a["time"], reverse=True)[:limit], None
        except (urllib.error.URLError, ET.ParseError, TimeoutError, OSError) as exc:
            return t, None, f"{t} ({type(exc).__name__})"

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(load, names))
    for t, items, err in results:
        is_market = t in market
        if err:
            failed.append(err)
            continue
        ok += 0 if is_market else 1
        for a in items:
            if a["time"] < cutoff:
                continue
            art = articles.setdefault(a["url"], {**a, "tickers": [], "market": False})
            if is_market:
                art["market"] = True
            elif t not in art["tickers"]:
                art["tickers"].append(t)
    return articles, ok, failed


def main() -> int:
    articles, ok, failed = collect(NEWS_TICKERS, MARKET_FEEDS)
    n_market = sum(1 for a in articles.values() if a["market"])
    print(f"Read {ok}/{len(NEWS_TICKERS)} ticker feeds, {len(articles)} articles ({n_market} market-wide).")
    if failed:
        print("Failed:", ", ".join(failed))
    if ok < MIN_FEEDS_OK * len(NEWS_TICKERS) or not articles:
        print("Too few feeds loaded; keeping the existing news.json.")
        return 1
    items = []
    for a in sorted(articles.values(), key=lambda a: a["time"], reverse=True):
        # The scorer reads title + full blurb; the file keeps a shortened plain-text blurb.
        item = {
            "title": a["title"], "url": a["url"], "time": a["time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "score": round(sentiment.score(f"{a['title']}. {clean_summary(a['summary'], 2000)}"), 3),
            "tickers": sorted(a["tickers"]),
        }
        summary = clean_summary(a["summary"])
        if summary and summary.rstrip("…").lower() != a["title"].lower():
            item["summary"] = summary
        if a["market"]:
            item["market"] = True
        items.append(item)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                               "items": items}, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
