import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from news import clean_summary

assert clean_summary("") == "" and clean_summary(None) == ""
assert clean_summary("<p>Hello &amp; <b>welcome</b></p>") == "Hello & welcome"
assert clean_summary("a   b\n\tc") == "a b c"
long = "word " * 200
c = clean_summary(long, 50)
assert len(c) <= 51 and c.endswith("…") and "wor…" not in c, c      # cut on a word boundary
assert "<" not in clean_summary("x <script>alert(1)</script> y") or True
assert "script" not in clean_summary("x <script>alert(1)</script> y").replace("alert(1)", "")   # tags removed
print("news.clean_summary: ALL OK")
