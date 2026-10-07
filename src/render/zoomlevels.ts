import type { Layout, Tree, ZoomOptions } from "../contract";

/** The zoom scales at which a group opens and closes. */
export interface ZoomLevel { kOpen: number; kClose: number }

/**
 * Fixed open and close scales for every group with children, so what is open
 * depends on the zoom level alone, not on the path taken to reach it. A child
 * never opens before its parent, and every group closes above `kMin`, the
 * zoom-out bound, so fully zoomed out always shows the top level closed.
 */
export function zoomLevels(tree: Tree, layout: Layout, kMin: number, opts: ZoomOptions): Map<string, ZoomLevel> {
  const levels = new Map<string, ZoomLevel>();
  const walk = (id: string, parentOpen: number) => {
    for (const c of tree.nodes.get(id)!.children) {
      const n = tree.nodes.get(c)!;
      if (n.kind === "page" || !n.children.length) continue;
      const r = layout.get(c)!.r;
      const kOpen = Math.max(opts.openPx / r, kMin * 1.25, parentOpen * 1.15);
      const kClose = Math.max(opts.closePx / r, kMin * 1.06, Math.min(kOpen * 0.85, parentOpen));
      levels.set(c, { kOpen, kClose: Math.min(kClose, kOpen * 0.95) });
      walk(c, kOpen);
    }
  };
  walk(tree.rootId, kMin);
  return levels;
}

/**
 * The groups open at scale `k`, given the set open a moment before (for the
 * hysteresis band between kClose and kOpen). The root is always open.
 */
export function nextOpen(tree: Tree, levels: Map<string, ZoomLevel>, k: number, prev: ReadonlySet<string>): Set<string> {
  const open = new Set<string>([tree.rootId]);
  const walk = (id: string) => {
    for (const c of tree.nodes.get(id)!.children) {
      const l = levels.get(c);
      if (!l) continue;
      if (k > (prev.has(c) ? l.kClose : l.kOpen)) {
        open.add(c);
        walk(c);
      }
    }
  };
  walk(tree.rootId);
  return open;
}

/** Move `o` toward `target` by at most `step`, landing on it exactly and staying there. */
export function approach(o: number, target: number, step: number): number {
  if (o === target) return o;
  return target > o ? Math.min(target, o + step) : Math.max(target, o - step);
}
