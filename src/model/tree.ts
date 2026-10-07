import type { RawGraph, RawPage, Tree, TreeNode } from "../contract";

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const byTitle = (nodes: Map<string, TreeNode>) => (a: string, b: string) =>
  nodes.get(a)!.title.localeCompare(nodes.get(b)!.title, undefined, { sensitivity: "base" });

/** Build the folder tree described in contract.ts from a RawGraph. */
export function buildTree(raw: RawGraph): Tree {
  const nodes = new Map<string, TreeNode>();
  const byPath = new Map<string, string>();
  const pages = new Map(raw.pages.map((p) => [p.path, p]));

  const node = (id: string, kind: TreeNode["kind"], page: RawPage | undefined, fallback: string, folder: string | null): TreeNode => {
    const n: TreeNode = {
      id, kind, folder,
      path: page?.path ?? null,
      title: page?.title ?? fallback,
      type: page?.type ?? null,
      tags: page?.tags ?? [],
      parent: null, children: [], depth: 0, weight: 0,
    };
    nodes.set(id, n);
    if (page) byPath.set(page.path, id);
    return n;
  };

  node("root", "root", pages.get("index.md"), "Index", "");

  const folders = new Set<string>();
  for (const p of raw.pages) {
    for (let d = dirname(p.path); d; d = dirname(d)) folders.add(d);
  }
  // A folder's hub is <folder>/<folder>.md, or else the one page in it named
  // <something>-<folder>.md, as in topic/notes/topic-notes.md.
  const hubOf = (f: string): RawPage | undefined => {
    const exact = pages.get(`${f}/${basename(f)}.md`);
    if (exact) return exact;
    const suffixed = raw.pages.filter((p) => dirname(p.path) === f && basename(p.path).endsWith(`-${basename(f)}`));
    return suffixed.length === 1 ? suffixed[0] : undefined;
  };
  for (const f of [...folders].sort()) {
    node(`dir:${f}`, "cluster", hubOf(f), basename(f), f);
  }
  for (const f of folders) {
    const parent = dirname(f) ? `dir:${dirname(f)}` : "root";
    nodes.get(`dir:${f}`)!.parent = parent;
  }

  for (const p of raw.pages) {
    if (byPath.has(p.path)) continue; // index.md or a hub
    const dir = dirname(p.path);
    let parent: string;
    if (dir) parent = `dir:${dir}`;
    else if (p.path === "log.md") parent = "root";
    else {
      if (!nodes.has("unfiled")) node("unfiled", "unfiled", undefined, "Unfiled", null).parent = "root";
      parent = "unfiled";
    }
    node(`page:${p.path}`, "page", p, basename(p.path), null).parent = parent;
  }

  for (const n of nodes.values()) if (n.parent) nodes.get(n.parent)!.children.push(n.id);
  const sort = byTitle(nodes);
  for (const n of nodes.values()) {
    const groups = n.children.filter((c) => nodes.get(c)!.kind === "cluster").sort(sort);
    const leaves = n.children.filter((c) => nodes.get(c)!.kind === "page").sort(sort);
    n.children = [...groups, ...(n.children.includes("unfiled") ? ["unfiled"] : []), ...leaves];
  }

  const visit = (id: string, depth: number): number => {
    const n = nodes.get(id)!;
    n.depth = depth;
    n.weight = (n.path ? 1 : 0) + n.children.reduce((s, c) => s + visit(c, depth + 1), 0);
    if (n.kind === "page") n.weight = 1;
    return n.weight;
  };
  visit("root", 0);

  return { rootId: "root", nodes, byPath };
}
