"""publish_lookup.py against a throwaway local 'GitHub' (a bare repo): creates the orphan branch, updates the index,
prunes old entries, replaces a repeat lookup, refuses bad input, never touches main."""
import json, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import publish_lookup as P

ok = 0
def check(cond, msg):
    global ok
    assert cond, msg
    ok += 1

def sh(cwd, *a):
    return subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

def result(sym, ts, found=True, name=None):
    return {"version": 1, "symbol": sym, "fetched": "t", "fetched_ts": ts, "found": found, "errors": {}, "profile": {"name": name or sym + " Inc"}}

with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    bare, work = d / "origin.git", d / "work"
    sh(d, "git", "init", "--bare", "-b", "main", str(bare))
    sh(d, "git", "clone", "-q", str(bare), str(work))
    (work / "README.md").write_text("main branch file\n")
    sh(work, "git", "add", "."); sh(work, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"); sh(work, "git", "push", "-q", "origin", "HEAD:main")
    main_before = sh(work, "git", "rev-parse", "origin/main")

    def put(sym, ts, **kw):
        f = d / f"{sym}.json"; f.write_text(json.dumps(result(sym, ts, **kw)))
        P.publish(sym, f, "origin", work)

    def branch_file(path):
        return json.loads(sh(bare, "git", "show", f"lookups:{path}"))

    # 1. first lookup creates the orphan branch with only its own files
    put("SOFI", 1000)
    files = sh(bare, "git", "ls-tree", "-r", "--name-only", "lookups").splitlines()
    check(sorted(files) == ["data/SOFI.json", "index.json"], files)
    check(branch_file("index.json")["items"][0]["symbol"] == "SOFI", "index")
    check(sh(bare, "git", "rev-list", "--count", "lookups") == "1", "one commit")
    check(sh(bare, "git", "rev-parse", "main") == main_before, "main untouched")
    check("README.md" not in files, "main's files not copied into the orphan branch")

    # 2. second symbol is added, newest first
    put("TSM", 2000)
    check([e["symbol"] for e in branch_file("index.json")["items"]] == ["TSM", "SOFI"], "order")

    # 3. repeating a symbol replaces it (no duplicate) and moves it to the front
    put("SOFI", 3000)
    items = branch_file("index.json")["items"]
    check([e["symbol"] for e in items] == ["SOFI", "TSM"] and items[0]["fetched_ts"] == 3000, items)
    check(branch_file("data/SOFI.json")["fetched_ts"] == 3000, "file replaced")

    # 4. a not-found result is published too (the page shows it instead of waiting forever)
    put("ZZZZ", 4000, found=False)
    check(branch_file("data/ZZZZ.json")["found"] is False, "not found published")
    check(branch_file("index.json")["items"][0]["found"] is False, "index flag")

    # 5. old entries are pruned beyond MAX_KEEP, with their files
    for i in range(P.MAX_KEEP + 3):
        put(f"A{i}", 5000 + i)
    items = branch_file("index.json")["items"]
    check(len(items) == P.MAX_KEEP, len(items))
    files = sh(bare, "git", "ls-tree", "-r", "--name-only", "lookups").splitlines()
    check(len(files) == P.MAX_KEEP + 1, len(files))
    check("data/SOFI.json" not in files and "data/A0.json" not in files and f"data/A{P.MAX_KEEP + 2}.json" in files, "oldest dropped")

    # 6. bad input is refused and nothing is pushed
    tip = sh(bare, "git", "rev-parse", "lookups")
    bad = d / "bad.json"
    for sym, body, why in [("../x", result("../x", 1), "path-like symbol"), ("SOFI", result("TSM", 1), "symbol mismatch"), ("SOFI", None, "not json")]:
        bad.write_text("not json" if body is None else json.dumps(body))
        try:
            P.publish(sym, bad, "origin", work); check(False, why + " accepted")
        except (ValueError, json.JSONDecodeError):
            check(True, why)
    big = d / "big.json"; big.write_text(json.dumps({**result("SOFI", 1), "pad": "x" * P.MAX_BYTES}))
    try:
        P.publish("SOFI", big, "origin", work); check(False, "oversize accepted")
    except ValueError:
        check(True, "oversize")
    check(sh(bare, "git", "rev-parse", "lookups") == tip, "branch unchanged by refused input")

    # 7. a push that loses a race starts again from the newest tip and keeps the other writer's work
    other = d / "other"; sh(d, "git", "clone", "-q", "-b", "lookups", str(bare), str(other))
    orig_git = P.git; state = {"n": 0}
    def racing(repo, *args, check=True):
        if args[:1] == ("push",) and state["n"] == 0:
            state["n"] = 1
            (other / "data" / "RACE.json").write_text("{}")
            sh(other, "git", "add", "."); sh(other, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "race"); sh(other, "git", "push", "-q", "origin", "HEAD:lookups")
        return orig_git(repo, *args, check=check)
    P.git = racing
    try:
        put("RACER", 9999)
    finally:
        P.git = orig_git
    files = sh(bare, "git", "ls-tree", "-r", "--name-only", "lookups").splitlines()
    check("data/RACER.json" in files and "data/RACE.json" in files and state["n"] == 1, "retry kept both writers' files")
    check(sh(work, "git", "worktree", "list").count("\n") == 0, "no worktrees left behind")

print(f"publish_lookup: all {ok} checks passed")
