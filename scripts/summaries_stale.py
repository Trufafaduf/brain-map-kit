#!/usr/bin/env python3
"""Find pages whose hover summary is missing or out of date, and merge new ones.

    python -I -X utf8 scripts/summaries_stale.py <wiki-dir> [--sidecar FILE] [--paths P ...] [--json]
    python -I -X utf8 scripts/summaries_stale.py <wiki-dir> --merge new.json [--sidecar FILE]
    python -I -X utf8 scripts/summaries_stale.py <wiki-dir> --prune [--sidecar FILE]

The sidecar defaults to <wiki-dir>/meta/map-summaries.json. Its entries are
keyed by page path relative to the wiki, and each holds the summary, the hash
of the page body it was written from, and the date:

    {"econ/utility.md": {"summary": "...", "hash": "1f0c...", "updated": "2026-10-07"}}

The hash is the first 16 hex characters of sha256 over the page body with its
frontmatter stripped, so editing only frontmatter (an `updated:` bump, a tag)
never makes a summary stale.

Listing (the default) prints one stale path per line, or with --json a list of
{"path", "title", "reason"} where reason is "missing" or "changed". --paths
limits the check to the given pages; each may be relative to the wiki or carry
a leading "<wiki-dir name>/" (as `git diff --name-only` prints from the repo
root); non-markdown paths and paths outside the wiki are ignored.

--merge reads {"path": "summary text", ...}, stamps each with the page's
current hash and today's date, and writes the sidecar back sorted by path.
--prune drops entries whose page no longer exists.
"""
import datetime, hashlib, json, os, re, sys

FM = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.S)
TITLE = re.compile(r"^title:\s*(.+)$", re.M)


def read(wiki, rel):
    with open(os.path.join(wiki, rel), encoding="utf-8") as f:
        return f.read()


def body_hash(text):
    m = FM.match(text)
    body = (text[m.end():] if m else text).replace("\r\n", "\n").strip()
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def title_of(text, rel):
    m = FM.match(text)
    t = TITLE.search(m.group(1)) if m else None
    return t.group(1).strip().strip("'\"") if t else os.path.basename(rel)[:-3]


def all_pages(wiki):
    out = []
    for dirpath, dirs, names in os.walk(wiki):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        out += [os.path.relpath(os.path.join(dirpath, n), wiki).replace(os.sep, "/") for n in sorted(names) if n.endswith(".md")]
    return out


def normalise(wiki, paths):
    prefix = os.path.basename(os.path.normpath(wiki)) + "/"
    out = []
    for p in paths:
        p = p.replace("\\", "/")
        if os.path.isabs(p):
            p = os.path.relpath(p, wiki).replace(os.sep, "/")
        elif p.startswith(prefix) and not os.path.exists(os.path.join(wiki, p)):
            p = p[len(prefix):]
        if p.endswith(".md") and not p.startswith("../") and os.path.isfile(os.path.join(wiki, p)):
            out.append(p)
    return sorted(set(out))


def load(sidecar):
    if not os.path.exists(sidecar):
        return {}
    with open(sidecar, encoding="utf-8") as f:
        return json.load(f)


def save(sidecar, data):
    os.makedirs(os.path.dirname(os.path.abspath(sidecar)), exist_ok=True)
    with open(sidecar, "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sorted(data.items())), f, indent=1, ensure_ascii=False)
        f.write("\n")


def main():
    argv = sys.argv[1:]
    opts, pos, i = {}, [], 0
    while i < len(argv):
        a = argv[i]
        if a in ("--sidecar", "--merge"):
            opts[a] = argv[i + 1]; i += 2
        elif a == "--paths":
            opts[a] = []
            i += 1
            while i < len(argv) and not argv[i].startswith("--"):
                opts[a].append(argv[i]); i += 1
        elif a.startswith("--"):
            opts[a] = True; i += 1
        else:
            pos.append(a); i += 1
    if not pos:
        sys.exit(__doc__)
    wiki = os.path.abspath(pos[0])
    sidecar = opts.get("--sidecar") or os.path.join(wiki, "meta", "map-summaries.json")
    data = load(sidecar)

    if "--merge" in opts:
        with open(opts["--merge"], encoding="utf-8") as f:
            new = json.load(f)
        today = datetime.date.today().isoformat()
        done = 0
        for rel, text in new.items():
            [rel_n] = normalise(wiki, [rel]) or [None]
            if not rel_n or not isinstance(text, str) or not text.strip():
                print(f"skipped {rel}: no such page or empty summary", file=sys.stderr)
                continue
            data[rel_n] = {"summary": " ".join(text.split()), "hash": body_hash(read(wiki, rel_n)), "updated": today}
            done += 1
        save(sidecar, data)
        print(f"merged {done} summaries into {os.path.normpath(sidecar)}")
        return

    if "--prune" in opts:
        live = set(all_pages(wiki))
        gone = [k for k in data if k not in live]
        for k in gone:
            del data[k]
        save(sidecar, data)
        print(f"pruned {len(gone)} entries" + "".join(f"\n  {k}" for k in gone))
        return

    pages = normalise(wiki, opts["--paths"]) if "--paths" in opts else all_pages(wiki)
    stale = []
    for rel in pages:
        text = read(wiki, rel)
        entry = data.get(rel)
        if not entry:
            stale.append({"path": rel, "title": title_of(text, rel), "reason": "missing"})
        elif entry.get("hash") != body_hash(text):
            stale.append({"path": rel, "title": title_of(text, rel), "reason": "changed"})
    if "--json" in opts:
        print(json.dumps(stale, indent=1, ensure_ascii=False))
    else:
        for s in stale:
            print(s["path"])
    print(f"{len(stale)} stale of {len(pages)} checked", file=sys.stderr)


if __name__ == "__main__":
    main()
