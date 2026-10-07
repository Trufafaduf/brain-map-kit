import type { ClusterInfo, Edge, GraphModel, ModelOptions, RankedLink, RawGraph, Tree, VisibleGraph } from "../contract";
import { DEFAULT_EXCLUDE } from "../contract";
import { buildTree } from "./tree";

const pairKey = (a: string, b: string) => `${a}\u0000${b}`;

/** Sum page-level links into edges between node ids, dropping self-links. */
export function nodeEdges(tree: Tree, raw: RawGraph): Edge[] {
  const sums = new Map<string, Edge>();
  for (const l of raw.links) {
    const s = tree.byPath.get(l.source), t = tree.byPath.get(l.target);
    if (!s || !t || s === t) continue;
    const k = pairKey(s, t);
    const e = sums.get(k);
    if (e) e.count += l.count;
    else sums.set(k, { source: s, target: t, count: l.count });
  }
  return [...sums.values()];
}

/** The visible graph for a set of open clusters, as specified in contract.ts. */
export function visibleGraph(tree: Tree, edges: Edge[], open: ReadonlySet<string>): VisibleGraph {
  const nodes: string[] = [], rings: string[] = [];
  const walk = (id: string) => {
    const n = tree.nodes.get(id)!;
    const isGroup = n.kind !== "page";
    if (isGroup && open.has(id)) {
      rings.push(id);
      if (n.path) nodes.push(id);
      n.children.forEach(walk);
    } else nodes.push(id);
  };
  walk(tree.rootId);

  // Representative: highest ancestor-or-self that is not open (or self).
  const rep = new Map<string, string>();
  const lift = (id: string): string => {
    const hit = rep.get(id);
    if (hit) return hit;
    const chain: string[] = [];
    for (let c: string | null = id; c; c = tree.nodes.get(c)!.parent) chain.unshift(c);
    const r = chain.find((c) => !open.has(c) || tree.nodes.get(c)!.kind === "page") ?? id;
    rep.set(id, r);
    return r;
  };

  const sums = new Map<string, Edge>();
  for (const e of edges) {
    const s = lift(e.source), t = lift(e.target);
    if (s === t) continue;
    const k = pairKey(s, t);
    const x = sums.get(k);
    if (x) x.count += e.count;
    else sums.set(k, { source: s, target: t, count: e.count });
  }
  return { nodes, rings, edges: [...sums.values()] };
}

interface Flow { linksIn: number; linksOut: number }

const flow = (m: Map<string, Flow>, k: string): Flow => {
  let f = m.get(k);
  if (!f) m.set(k, (f = { linksIn: 0, linksOut: 0 }));
  return f;
};

/** Score per contract: both directions summed, plus 2 when the link is mutual. */
const score = (f: Flow) => f.linksIn + f.linksOut + (f.linksIn > 0 && f.linksOut > 0 ? 2 : 0);

/**
 * Precomputed rankings: per-node neighbour flows, per-group flows across its
 * subtree boundary, and link weight between sibling groups. Built once so
 * hover lookups only sort and slice.
 */
export function rankings(tree: Tree, edges: Edge[], inbound: (id: string) => number, exclude: string[]) {
  const res = exclude.map((e) => new RegExp(e));
  const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const skip = (id: string) => {
    if (id === tree.rootId) return true;
    const p = tree.nodes.get(id)?.path;
    return !!p && res.some((r) => r.test(basename(p)));
  };
  const title = (id: string) => tree.nodes.get(id)!.title;
  const ranked = (pairs: [string, Flow][]): RankedLink[] =>
    pairs
      .filter(([id]) => !skip(id))
      .map(([id, f]) => ({ id, title: title(id), score: score(f), ...f, inbound: inbound(id) }))
      .sort((a, b) => b.score - a.score || b.inbound - a.inbound || a.title.localeCompare(b.title));

  // Ancestor-or-self chains, root first.
  const chain = new Map<string, string[]>();
  const chainOf = (id: string): string[] => {
    let c = chain.get(id);
    if (!c) {
      const p = tree.nodes.get(id)!.parent;
      c = p ? [...chainOf(p), id] : [id];
      chain.set(id, c);
    }
    return c;
  };

  const adj = new Map<string, Map<string, Flow>>();
  const across = new Map<string, Map<string, Flow>>(); // group -> member -> flow over its boundary
  const between = new Map<string, Map<string, number>>(); // sibling -> sibling -> weight
  const add = (m: Map<string, Map<string, number>>, a: string, b: string, n: number) => {
    let x = m.get(a);
    if (!x) m.set(a, (x = new Map()));
    x.set(b, (x.get(b) ?? 0) + n);
  };
  for (const e of edges) {
    let a = adj.get(e.source);
    if (!a) adj.set(e.source, (a = new Map()));
    flow(a, e.target).linksOut += e.count;
    let b = adj.get(e.target);
    if (!b) adj.set(e.target, (b = new Map()));
    flow(b, e.source).linksIn += e.count;

    const cs = chainOf(e.source), ct = chainOf(e.target);
    let i = 0;
    while (i < cs.length && i < ct.length && cs[i] === ct[i]) i++;
    // Groups holding one end but not the other: everything below the common ancestor.
    for (const g of ct.slice(i)) {
      let m = across.get(g);
      if (!m) across.set(g, (m = new Map()));
      flow(m, e.target).linksIn += e.count;
    }
    for (const g of cs.slice(i)) {
      let m = across.get(g);
      if (!m) across.set(g, (m = new Map()));
      flow(m, e.source).linksOut += e.count;
    }
    if (i < cs.length && i < ct.length) {
      add(between, cs[i], ct[i], e.count);
      add(between, ct[i], cs[i], e.count);
    }
  }

  const linkCache = new Map<string, RankedLink[]>();
  const rankLinks = (id: string, limit = 8): RankedLink[] => {
    let r = linkCache.get(id);
    if (!r) linkCache.set(id, (r = ranked([...(adj.get(id) ?? [])])));
    return r.slice(0, limit);
  };

  const infoCache = new Map<string, { entryPoints: RankedLink[]; neighbours: ClusterInfo["neighbours"] }>();
  const clusterInfo = (id: string, limit = 5): ClusterInfo => {
    let c = infoCache.get(id);
    if (!c) {
      const n = tree.nodes.get(id);
      const entryPoints = n?.kind === "page" ? [] : ranked([...(across.get(id) ?? [])].filter(([e, f]) => e !== id && f.linksIn > 0))
        .sort((a, b) => b.linksIn - a.linksIn || b.score - a.score || b.inbound - a.inbound || a.title.localeCompare(b.title));
      const neighbours = n?.kind === "page" ? [] : [...(between.get(id) ?? [])]
        .filter(([s]) => tree.nodes.get(s)!.kind !== "page")
        .map(([s, weight]) => ({ id: s, title: title(s), weight }))
        .sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));
      infoCache.set(id, (c = { entryPoints, neighbours }));
    }
    return { entryPoints: c.entryPoints.slice(0, limit), neighbours: c.neighbours.slice(0, limit) };
  };

  return { rankLinks, clusterInfo };
}

/** The full model, as specified in contract.ts. */
export function createModel(raw: RawGraph, options: ModelOptions = { exclude: DEFAULT_EXCLUDE }): GraphModel {
  const tree = buildTree(raw);
  const edges = nodeEdges(tree, raw);
  const inb = new Map<string, number>(), out = new Map<string, number>();
  for (const e of edges) {
    inb.set(e.target, (inb.get(e.target) ?? 0) + e.count);
    out.set(e.source, (out.get(e.source) ?? 0) + e.count);
  }
  const inbound = (id: string) => inb.get(id) ?? 0;
  const { rankLinks, clusterInfo } = rankings(tree, edges, inbound, options.exclude);
  return {
    tree,
    edges,
    visible: (open) => visibleGraph(tree, edges, open),
    rankLinks,
    clusterInfo,
    inbound,
    outbound: (id) => out.get(id) ?? 0,
  };
}
