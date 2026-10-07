#!/usr/bin/env python3
"""Write a wiki's pages and resolved links as a RawGraph fixture (src/contract.ts).

    python -I -X utf8 scripts/dump_fixture.py <wiki-dir> [out.json]

out.json defaults to fixtures/local/graph.json, which is gitignored: a real
wiki's titles and structure never belong in the kit.

Link resolution follows Obsidian's closely enough for testing: [[target]],
[[target|alias]], [[target#heading]] and ![[embeds]] count; links inside code
blocks, inline code and %% comments don't; a bare name resolves to the file
with that basename, preferring the linking page's own folder, then the
shortest path; a name with slashes matches the end of a path. Wikilinks in
frontmatter count too, as Obsidian's resolvedLinks does.
"""
import json, os, re, sys
from collections import Counter, defaultdict

FM = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.S)
FENCE = re.compile(r"^(```|~~~).*?^\1[^\n]*$", re.S | re.M)
INLINE = re.compile(r"`[^`\n]*`")
COMMENT = re.compile(r"%%.*?%%", re.S)
WIKILINK = re.compile(r"!?\[\[([^\]\n]+?)\]\]")


def frontmatter(text):
    m = FM.match(text)
    if not m:
        return {}, text
    out, key = {}, None
    for line in m.group(1).splitlines():
        if re.match(r"^\s+-\s+", line) and key:
            out.setdefault(key, [])
            if isinstance(out[key], list):
                out[key].append(line.split("-", 1)[1].strip().strip("'\""))
            continue
        kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                out[key] = [v.strip().strip("'\"") for v in val[1:-1].split(",") if v.strip()]
            elif val:
                out[key] = val.strip("'\"")
            else:
                out[key] = []
    return out, text[m.end():]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    wiki = os.path.abspath(args[0])
    out = args[1] if len(args) > 1 else os.path.join(os.path.dirname(__file__), "..", "fixtures", "local", "graph.json")

    files = []
    for dirpath, dirs, names in os.walk(wiki):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for n in sorted(names):
            if n.endswith(".md"):
                files.append(os.path.relpath(os.path.join(dirpath, n), wiki).replace(os.sep, "/"))

    by_name = defaultdict(list)
    for p in files:
        by_name[os.path.basename(p)[:-3].lower()].append(p)

    def resolve(target, src):
        t = target.split("|", 1)[0].split("#", 1)[0].split("^", 1)[0].strip()
        if not t:
            return None
        if t.lower().endswith(".md"):
            t = t[:-3]
        if "/" in t:
            suffix = "/" + t.lower() + ".md"
            hits = [p for p in files if ("/" + p.lower()).endswith(suffix)]
        else:
            hits = by_name.get(t.lower(), [])
        if not hits:
            return None
        here = os.path.dirname(src)
        same = [p for p in hits if os.path.dirname(p) == here]
        return (same or sorted(hits, key=lambda p: (p.count("/"), len(p))))[0]

    pages, links = [], []
    for p in files:
        with open(os.path.join(wiki, p), encoding="utf-8") as f:
            text = f.read()
        fm, body = frontmatter(text)
        tags = fm.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        pages.append({
            "path": p,
            "title": fm.get("title") if isinstance(fm.get("title"), str) else os.path.basename(p)[:-3],
            "type": fm.get("type") if isinstance(fm.get("type"), str) else None,
            "tags": tags,
        })
        fm_text = FM.match(text).group(1) if FM.match(text) else ""
        clean = COMMENT.sub("", INLINE.sub("", FENCE.sub("", body)))
        counts = Counter()
        for m in WIKILINK.finditer(fm_text + "\n" + clean):
            dest = resolve(m.group(1), p)
            if dest:
                counts[dest] += 1
        links += [{"source": p, "target": d, "count": c} for d, c in sorted(counts.items())]

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"pages": pages, "links": links}, f, indent=1, ensure_ascii=False)
    print(f"{len(pages)} pages, {len(links)} link pairs, {sum(l['count'] for l in links)} links -> {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
