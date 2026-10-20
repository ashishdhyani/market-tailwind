import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from sentiment import score

cases = [
    ("Nvidia beats estimates, raises forecast as demand surges", ">0"),
    ("Oil plunges as demand fears deepen", "<0"),
    ("Company fails to beat expectations", "<0"),       # negation flips 'beat'
    ("Company does not cut dividend", ">0"),            # negation flips 'cut'
    ("Stocks were mixed on Tuesday", "=0"),
    ("", "=0"),
    ("Chip stocks decline as AI trade stalls", "<0"),
    ("Record profit and strong growth", ">0"),
]
bad = 0
for text, want in cases:
    s = score(text)
    ok = (s > 0) if want == ">0" else (s < 0) if want == "<0" else s == 0
    assert -1 < s < 1
    if not ok:
        bad += 1
        print("FAIL", repr(text), s, want)
print("sentiment:", "ALL OK" if not bad else f"{bad} FAILED")
sys.exit(bad)
