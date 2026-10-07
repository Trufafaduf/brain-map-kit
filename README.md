# brain-map-kit

An Obsidian plugin that draws a wiki's folder tree as a graph in the style of
Obsidian's own graph view, with two additions:

- **Semantic zoom.** Fully zoomed out you see the top-level clusters, closed.
  Each folder is a cluster that opens into its sub-folders and pages as you
  zoom in, at fixed zoom levels, so zooming back out always returns to the
  first frame. Reset (the button, Esc, a double-click on empty space, or the
  command "Reset brain map view") flies straight back there.
- **Hover cards.** Every node shows a short summary, its folder path and its
  most relevant links: top links for a page, entry points and linked clusters
  for a cluster. Click a row to fly there. Summaries come from a sidecar JSON file written by an LLM (see
  below), keyed by a hash of each page's body so only changed pages need
  rewriting.

A search box (Ctrl/Cmd+F) flies to any page and opens its clusters on the way,
and a breadcrumb bar shows where you are.

It suits a wiki kept as one tree: every page in exactly one folder, every
folder with a hub page named after it (`notes/notes.md`, or a single
`<name>-notes.md`), and an `index.md` at the root. Pages at
the root other than `index.md` and `log.md` show up in a red Unfiled circle.

No other plugins are needed. Colours come from your theme's graph variables.

## Status

v0.4.0: semantic zoom, reset, hover cards with ranked links, search and
breadcrumbs all work.

## Install

```sh
npm install
npm run build
powershell -ExecutionPolicy Bypass -File scripts/link-plugin.ps1 -Vault "<path to vault>"
```

Then enable **Brain map** under Settings → Community plugins, and set the
scope folder (default `wiki`) and summaries file in its settings. Open it from
the ribbon or the command "Open brain map".

## Summaries sidecar

```json
{ "topic/page.md": { "summary": "...", "hash": "<16 hex>", "updated": "YYYY-MM-DD" } }
```

`scripts/summaries_stale.py <wiki>` lists pages whose summary is missing or
whose body changed; `--merge new.json` stamps and merges `{path: summary}`;
`--prune` drops entries for deleted pages. The summaries themselves are written
by whatever model maintains the wiki.

## Develop

- `src/contract.ts` is the shared contract; every module codes against it.
- `npm test` runs the model tests on `fixtures/synthetic-2000.json`, and on
  `fixtures/local/graph.json` when present.
- `python scripts/dump_fixture.py <wiki>` writes your own wiki to
  `fixtures/local/` (gitignored, never committed).
- `npm run harness` serves `dev/` at http://localhost:8000/dev/ to run the
  map in a browser without Obsidian.
- `python scripts/install_hooks.py` installs the identifying-info pre-commit
  hook. Add private terms to `.identifying-denylist.txt` (gitignored).

MIT licence.
