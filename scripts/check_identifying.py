#!/usr/bin/env python3
"""Block commits that would publish identifying information.

    python scripts/check_identifying.py            # check staged changes (pre-commit)
    python scripts/check_identifying.py --all      # check every tracked and untracked, non-ignored file

Two lists are checked:

1. Built-in patterns that identify anyone: home-directory paths, claude.ai
   artifact links, and email addresses (except noreply and example domains).
2. Your private terms, one per line, in `.identifying-denylist.txt` at the repo
   root. That file is gitignored, so your name never appears in the kit itself.
   Lines starting with # are comments. Matching is case-insensitive; a line
   wrapped in slashes (/like this/) is a regular expression.

Install as a pre-commit hook with `python scripts/install_hooks.py`.
Exit status 1 blocks the commit and lists every hit.
"""
import os, re, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()
DENYLIST = os.path.join(ROOT, ".identifying-denylist.txt")
SELF = "scripts/check_identifying.py"

BUILTIN = [
    ("home path", re.compile(r"\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s\"'`]+", re.I)),
    ("home path", re.compile(r"(?<![\w.])/(?:Users|home)/(?!<)[A-Za-z0-9._-]+", re.I)),
    ("artifact link", re.compile(r"claude\.ai/(?:code/)?artifacts?/[A-Za-z0-9-]+", re.I)),
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@(?!(?:users\.noreply\.github\.com|anthropic\.com|example\.(?:com|org|net))\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
]

def private_terms():
    out = []
    if not os.path.exists(DENYLIST): return out
    for line in open(DENYLIST, encoding="utf-8"):
        t = line.strip()
        if not t or t.startswith("#"): continue
        pat = re.compile(t[1:-1], re.I) if len(t) > 2 and t[0] == t[-1] == "/" else re.compile(re.escape(t), re.I)
        out.append(("private term", pat))
    return out

def git(*args):
    return subprocess.run(["git", *args], capture_output=True, cwd=ROOT).stdout

def files_to_check(all_files):
    if all_files:
        names = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").decode("utf-8", "replace").split("\0")
        return [(n, lambda n=n: open(os.path.join(ROOT, n), "rb").read()) for n in names if n and os.path.isfile(os.path.join(ROOT, n))]
    names = git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR").decode("utf-8", "replace").split("\0")
    return [(n, lambda n=n: git("show", ":" + n)) for n in names if n]

def main():
    all_files = "--all" in sys.argv
    pats = BUILTIN + private_terms()
    hits = []
    for name, read in files_to_check(all_files):
        for label, p in pats:            # the file name itself can identify
            if label != "email" and p.search(name): hits.append((name, 0, label, name))
        if name.replace("\\", "/") == SELF: continue   # its own patterns would match themselves
        data = read()
        if b"\0" in data[:8000]: continue               # skip binaries
        text = data.decode("utf-8", "replace")
        for ln, line in enumerate(text.splitlines(), 1):
            for label, p in pats:
                m = p.search(line)
                if m: hits.append((name, ln, label, m.group(0)))
    if not os.path.exists(DENYLIST):
        print("note: no .identifying-denylist.txt, so only the built-in patterns were checked.", file=sys.stderr)
    if hits:
        print("Blocked: identifying information found.", file=sys.stderr)
        for name, ln, label, s in hits:
            print(f"  {name}:{ln}  {label}: {s}", file=sys.stderr)
        print("Fix these, or if one is a false positive, rephrase it. Don't bypass with --no-verify.", file=sys.stderr)
        return 1
    print(f"identifying-info check: clean ({'all files' if all_files else 'staged changes'}).")
    return 0

if __name__ == "__main__":
    sys.exit(main())
