"""Publish one lookup result to the `lookups` branch (an orphan branch that holds only lookup JSON files).

    python tools/publish_lookup.py SYMBOL result.json [--remote origin] [--repo .]

The branch has data/<SYMBOL>.json for each lookup plus index.json (newest first, at most MAX_KEEP entries; older
files are removed). The Lookup tab reads these through raw.githubusercontent.com. Nothing here touches `main`,
so a lookup never triggers a site deploy. Safe to run concurrently: on a rejected push it starts again from the
newest branch tip.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BRANCH = "lookups"
MAX_KEEP = 60
MAX_BYTES = 3_000_000
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
IDENT = ["-c", "user.name=market-tailwind-bot", "-c", "user.email=actions@users.noreply.github.com"]


def git(repo, *args, check=True):
    r = subprocess.run(["git", *IDENT, *args], cwd=repo, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip() or r.stdout.strip()}")
    return r


def read_index(path: Path) -> list:
    try:
        data = json.loads(path.read_text())
        return [e for e in data.get("items", []) if isinstance(e, dict) and SYMBOL_RE.match(str(e.get("symbol", "")))]
    except (OSError, ValueError, AttributeError):
        return []


def apply(tree: Path, symbol: str, result: dict) -> None:
    """Write the result and refresh index.json inside a checked-out copy of the branch."""
    (tree / "data").mkdir(exist_ok=True)
    (tree / "data" / f"{symbol}.json").write_text(json.dumps(result, separators=(",", ":"), allow_nan=False))
    items = [e for e in read_index(tree / "index.json") if e["symbol"] != symbol]
    profile = result.get("profile") or {}
    items.append({"symbol": symbol, "name": (profile.get("name") or "")[:90] or None, "found": bool(result.get("found")),
                  "fetched": result.get("fetched"), "fetched_ts": int(result.get("fetched_ts") or 0)})
    items.sort(key=lambda e: e.get("fetched_ts") or 0, reverse=True)
    keep, drop = items[:MAX_KEEP], items[MAX_KEEP:]
    for e in drop:
        (tree / "data" / f"{e['symbol']}.json").unlink(missing_ok=True)
    (tree / "index.json").write_text(json.dumps({"items": keep}, separators=(",", ":")))


def publish(symbol: str, src: Path, remote: str = "origin", repo: Path = Path("."), attempts: int = 5) -> None:
    symbol = symbol.strip().upper()
    if not SYMBOL_RE.match(symbol):
        raise ValueError(f"not a valid symbol: {symbol!r}")
    raw = src.read_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError("result is unexpectedly large; refusing to publish it")
    result = json.loads(raw)
    if result.get("symbol") != symbol:
        raise ValueError("result file is for a different symbol")

    last = None
    for attempt in range(1, attempts + 1):
        tmp = Path(tempfile.mkdtemp(prefix="lookups-"))
        tree = tmp / "tree"
        try:
            exists = git(repo, "ls-remote", "--exit-code", "--heads", remote, BRANCH, check=False).returncode == 0
            if exists:
                git(repo, "fetch", "--quiet", remote, f"+refs/heads/{BRANCH}:refs/remotes/{remote}/{BRANCH}")
                git(repo, "worktree", "add", "--quiet", "--detach", str(tree), f"{remote}/{BRANCH}")
            else:
                git(repo, "worktree", "add", "--quiet", "--detach", str(tree), "HEAD")
                git(tree, "checkout", "--quiet", "--orphan", BRANCH)
                git(tree, "rm", "-rf", "--quiet", ".", check=False)
                for leftover in tree.iterdir():            # an orphan branch starts empty
                    if leftover.name != ".git":
                        shutil.rmtree(leftover) if leftover.is_dir() else leftover.unlink()
            apply(tree, symbol, result)
            git(tree, "add", "-A")
            if git(tree, "diff", "--cached", "--quiet", check=False).returncode == 0:
                return
            git(tree, "commit", "--quiet", "-m", f"Lookup {symbol}")
            push = git(tree, "push", "--quiet", remote, f"HEAD:refs/heads/{BRANCH}", check=False)
            if push.returncode == 0:
                return
            last = push.stderr.strip()
        finally:
            git(repo, "worktree", "remove", "--force", str(tree), check=False)
            git(repo, "worktree", "prune", check=False)
            shutil.rmtree(tmp, ignore_errors=True)
    raise RuntimeError(f"could not push after {attempts} attempts: {last}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("result", type=Path)
    ap.add_argument("--remote", default="origin")
    ap.add_argument("--repo", type=Path, default=Path("."))
    a = ap.parse_args(argv)
    publish(a.symbol, a.result, a.remote, a.repo)
    print(f"published {a.symbol.upper()} to branch {BRANCH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
