#!/usr/bin/env python3
"""Write a synthetic RawGraph for performance testing (no real content).

    python -I -X utf8 scripts/synth_fixture.py [pages] [out.json]

Defaults: 2000 pages, fixtures/synthetic-2000.json. A fixed seed makes the file
the same on every run. The tree is index.md, 8 top-level folders, up to 4
sub-folders each, every folder with a hub; links are mostly within a folder,
some to the parent hub, a few across the tree.
"""
import json, os, random, sys

n = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "fixtures", f"synthetic-{n}.json")
rng = random.Random(7)
types = ["concept", "source", "entity", "analysis", "question", "project"]

folders = []
for i in range(8):
    top = f"area-{i}"
    folders.append(top)
    folders += [f"{top}/sub-{j}" for j in range(rng.randint(0, 4))]

pages = [{"path": "index.md", "title": "Index", "type": "index", "tags": []},
         {"path": "log.md", "title": "Log", "type": "log", "tags": []}]
for f in folders:
    name = f.split("/")[-1]
    pages.append({"path": f"{f}/{name}.md", "title": name.replace("-", " ").title(), "type": "concept", "tags": [name]})
by_folder = {f: [f"{f}/{f.split('/')[-1]}.md"] for f in folders}
while len(pages) < n:
    f = rng.choice(folders)
    k = len(by_folder[f])
    p = f"{f}/page-{k}.md"
    pages.append({"path": p, "title": f"{f.split('/')[-1]} page {k}", "type": rng.choice(types), "tags": [f.split("/")[0]]})
    by_folder[f].append(p)

links = {}
def add(s, t):
    if s != t:
        links[(s, t)] = links.get((s, t), 0) + 1
for f, ps in by_folder.items():
    hub = ps[0]
    parent = "/".join(f.split("/")[:-1])
    add("index.md", hub) if "/" not in f else add(f"{parent}/{parent.split('/')[-1]}.md", hub)
    for p in ps[1:]:
        add(hub, p); add(p, hub)
        for _ in range(rng.randint(1, 4)):
            add(p, rng.choice(ps))
        if rng.random() < 0.25:
            add(p, rng.choice(pages)["path"])

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"pages": pages, "links": [{"source": s, "target": t, "count": c} for (s, t), c in sorted(links.items())]}, fh, indent=1)
print(f"{len(pages)} pages, {len(links)} link pairs -> {os.path.normpath(out)}")
