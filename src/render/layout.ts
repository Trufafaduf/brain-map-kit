import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { GraphModel, Layout, Tree } from "../contract";

/** World radius of a page dot, and of the hub dot at an open cluster's centre. */
export const PAGE_R = 5;
export const HUB_R = 8;
/** Gap between a cluster's children and its ring. */
const RING_PAD = 10;

type SimNode = SimulationNodeDatum & { id: string; r: number };

/**
 * Nested layout for every node at every depth, computed once with fixed seeds.
 * Each group (root, cluster, unfiled) lays its children out in its own small
 * force simulation around its centre, where its hub sits, linked by the
 * page-level edges lifted to sibling level. A group's radius is the circle
 * enclosing its children, so a child's circle always lies inside its parent's.
 */
export function computeLayout(model: GraphModel): Layout {
  const { tree, edges } = model;
  const local = new Map<string, { x: number; y: number; r: number }>();

  // The ancestor of `id` that is a direct child of `group`, or null.
  const chains = new Map<string, string[]>();
  const chain = (id: string) => {
    let c = chains.get(id);
    if (!c) {
      c = [];
      for (let n: string | null = id; n; n = tree.nodes.get(n)!.parent) c.unshift(n);
      chains.set(id, c);
    }
    return c;
  };
  const under = (id: string, group: string, depth: number): string | null => {
    const c = chain(id);
    return c[depth] === group ? c[depth + 1] ?? group : null;
  };

  const place = (id: string): number => {
    const n = tree.nodes.get(id)!;
    if (n.kind === "page") return PAGE_R;
    const kids = n.children.map((c) => ({ id: c, r: place(c) }));
    if (!kids.length) return HUB_R + RING_PAD;

    const centre: SimNode = { id, r: n.path ? HUB_R : 0, fx: 0, fy: 0 };
    const sims: SimNode[] = [centre, ...kids];
    const links = new Map<string, number>();
    for (const e of edges) {
      const a = under(e.source, id, n.depth), b = under(e.target, id, n.depth);
      if (!a || !b || a === b) continue;
      const k = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      links.set(k, (links.get(k) ?? 0) + e.count);
    }
    const leafy = kids.every((k) => tree.nodes.get(k.id)!.kind === "page");
    const sim = forceSimulation(sims)
      .alphaDecay(0.035)
      .randomSource(seeded(hash(id)))
      .force("link", forceLink([...links].map(([k, w]) => {
        const [source, target] = k.split("\u0000");
        return { source, target, w };
      })).id((d) => (d as SimNode).id).strength((l) => Math.min(0.3, 0.03 * (l as { w: number }).w)).distance((l) => {
        const s = l.source as unknown as SimNode, t = l.target as unknown as SimNode;
        return s.r + t.r + (leafy ? 18 : 30);
      }))
      .force("charge", forceManyBody<SimNode>().strength((d) => (d.r > PAGE_R ? -6 * d.r : -40)))
      .force("collide", forceCollide<SimNode>((d) => d.r + (leafy ? 9 : 14)).iterations(2))
      // Pages pack tightly round the hub; whole clusters drift in more gently,
      // so collision can keep them clear of the hub at the centre.
      .force("x", forceX<SimNode>(0).strength((d) => (d.r > PAGE_R ? 0.03 : 0.12)))
      .force("y", forceY<SimNode>(0).strength((d) => (d.r > PAGE_R ? 0.03 : 0.12)))
      .stop();
    for (let i = 0; i < 160; i++) sim.tick();
    relax(sims, leafy ? 6 : 10);

    let r = centre.r;
    for (const k of kids as SimNode[]) {
      local.set(k.id, { x: k.x ?? 0, y: k.y ?? 0, r: k.r });
      r = Math.max(r, Math.hypot(k.x ?? 0, k.y ?? 0) + k.r);
    }
    return r + RING_PAD;
  };

  const layout: Layout = new Map();
  place(tree.rootId);
  // The root draws no ring, so centre it on its children rather than holding
  // the index at the middle: the top level then sits evenly round the view.
  const top = tree.nodes.get(tree.rootId)!.children.map((c) => local.get(c)!);
  const minX = Math.min(...top.map((p) => p.x - p.r)), maxX = Math.max(...top.map((p) => p.x + p.r));
  const minY = Math.min(...top.map((p) => p.y - p.r)), maxY = Math.max(...top.map((p) => p.y + p.r));
  const cx = top.length ? (minX + maxX) / 2 : 0, cy = top.length ? (minY + maxY) / 2 : 0;
  for (const p of top) { p.x -= cx; p.y -= cy; }
  // The index sits at the free spot nearest the middle, outside every
  // top-level circle, found by walking out along a spiral.
  let hx = 0, hy = 0;
  const clear = (x: number, y: number) => top.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + HUB_R + RING_PAD);
  for (let i = 0; i < 4000 && !clear(hx, hy); i++) {
    const a = i * 0.5, d = 4 * Math.sqrt(i) * HUB_R;
    hx = d * Math.cos(a); hy = d * Math.sin(a);
  }
  for (const p of top) { p.x -= hx; p.y -= hy; }
  let rootR = HUB_R + RING_PAD;
  for (const p of top) rootR = Math.max(rootR, Math.hypot(p.x, p.y) + p.r + RING_PAD);
  const [ox, oy] = [hx, hy];
  const absolute = (id: string, x: number, y: number, r: number) => {
    layout.set(id, { x, y, r });
    for (const c of tree.nodes.get(id)!.children) {
      const p = local.get(c)!;
      absolute(c, x + p.x, y + p.y, p.r);
    }
  };
  absolute(tree.rootId, ox, oy, rootR);
  return layout;
}

/** Smallest radius among groups that can open, for the zoom bound. */
export function smallestGroupR(tree: Tree, layout: Layout): number {
  let min = Infinity;
  for (const n of tree.nodes.values()) if (n.kind !== "page" && n.children.length) min = Math.min(min, layout.get(n.id)!.r);
  return Number.isFinite(min) ? min : HUB_R;
}

/**
 * Push apart any circles that still overlap after the simulation, with `gap`
 * between them. The fixed centre (the hub) never moves.
 */
function relax(nodes: SimNode[], gap: number): void {
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = (b.x ?? 0) - (a.x ?? 0), dy = (b.y ?? 0) - (a.y ?? 0);
      const d = Math.hypot(dx, dy) || 1e-3, want = a.r + b.r + gap;
      if (d >= want) continue;
      moved = true;
      const push = want - d, ux = dx / d, uy = dy / d;
      const aFixed = a.fx != null, bFixed = b.fx != null;
      const sa = aFixed ? 0 : bFixed ? 1 : 0.5, sb = 1 - sa;
      a.x = (a.x ?? 0) - ux * push * sa; a.y = (a.y ?? 0) - uy * push * sa;
      b.x = (b.x ?? 0) + ux * push * sb; b.y = (b.y ?? 0) + uy * push * sb;
    }
    if (!moved) break;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic random source so the layout is identical on every open. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
