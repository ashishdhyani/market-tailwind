"""Download recent headlines for every sector ETF / stock from Yahoo Finance's public RSS feeds,
score their tone, and write site/news.json.

    python news.py

Headlines are untrusted text: we keep only the title, a link, a timestamp and our own score, and
the web page escapes everything it shows. Nothing is written if too few feeds could be read, so a
blocked run keeps yesterday's file.
"""
import json
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
from settings import SECTOR_TICKERS

OUT = Path(__file__).parent / "site" / "news.json"
FEED = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={}&region=US&lang=en-US"
KEEP_DAYS = 10
PER_TICKER = 15
MIN_FEEDS_OK = 0.8  # fraction of tickers that must load
# Some Python builds (e.g. python.org on macOS) ship without a CA bundle; certifi always has one.
CONTEXT = ssl.create_default_context(cafile=certifi.where())


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


def collect(tickers, pause: float = 0.3):
    """Merge feeds into one list of articles; an article seen under several tickers is stored once."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    articles, ok, failed = {}, 0, []
    for t in tickers:
        try:
            items = sorted(fetch_feed(t), key=lambda a: a["time"], reverse=True)[:PER_TICKER]
            ok += 1
        except (urllib.error.URLError, ET.ParseError, TimeoutError, OSError) as exc:
            failed.append(f"{t} ({type(exc).__name__})")
            continue
        for a in items:
            if a["time"] < cutoff:
                continue
            art = articles.setdefault(a["url"], {**a, "tickers": []})
            if t not in art["tickers"]:
                art["tickers"].append(t)
        time.sleep(pause)
    return articles, ok, failed


def main() -> int:
    articles, ok, failed = collect(SECTOR_TICKERS)
    print(f"Read {ok}/{len(SECTOR_TICKERS)} feeds, {len(articles)} articles.")
    if failed:
        print("Failed:", ", ".join(failed))
    if ok < MIN_FEEDS_OK * len(SECTOR_TICKERS) or not articles:
        print("Too few feeds loaded; keeping the existing news.json.")
        return 1
    items = []
    for a in sorted(articles.values(), key=lambda a: a["time"], reverse=True):
        # Title plus the short blurb gives the scorer more to work with; only the title is stored.
        items.append({
            "title": a["title"], "url": a["url"], "time": a["time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "score": round(sentiment.score(f"{a['title']}. {a['summary']}"), 3), "tickers": sorted(a["tickers"]),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                               "items": items}, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
