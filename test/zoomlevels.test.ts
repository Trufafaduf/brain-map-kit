import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/contract";
import { createModel } from "../src/model/graph";
import { computeLayout } from "../src/render/layout";
import { approach, nextOpen, zoomLevels } from "../src/render/zoomlevels";

const LOCAL = "fixtures/local/graph.json";
const SYNTH = "fixtures/synthetic-2000.json";
const opts = { openPx: DEFAULT_SETTINGS.openPx, closePx: DEFAULT_SETTINGS.closePx };

describe("zoom levels", { timeout: 60000 }, () => {
  for (const file of [SYNTH, LOCAL]) {
    it.skipIf(!existsSync(file))(`open state depends on zoom level, not zoom history (${file})`, () => {
      const m = createModel(JSON.parse(readFileSync(file, "utf8")));
      const layout = computeLayout(m), tree = m.tree;
      // The zoom-out bound the renderer would use: the whole top level fitted to an 800 px view.
      const top = tree.nodes.get(tree.rootId)!.children.map((c) => layout.get(c)!);
      const span = Math.max(...top.map((p) => p.x + p.r)) - Math.min(...top.map((p) => p.x - p.r));
      const kMin = 0.92 * 800 / span, kMax = kMin * 400;
      const levels = zoomLevels(tree, layout, kMin, opts);
      const groups = [...tree.nodes.values()].filter((n) => n.kind !== "page" && n.children.length && n.id !== tree.rootId);
      expect(levels.size).toBe(groups.length);

      for (const n of groups) {
        const l = levels.get(n.id)!;
        expect(l.kClose).toBeLessThan(l.kOpen);
        expect(l.kClose).toBeGreaterThan(kMin);
        const p = levels.get(n.parent!);
        if (p) expect(l.kOpen).toBeGreaterThan(p.kOpen);
      }

      // Fully zoomed out, everything closes, whatever was open before.
      const all = new Set(tree.nodes.keys());
      expect([...nextOpen(tree, levels, kMin, all)]).toEqual([tree.rootId]);

      // Zoom in step by step to the bound, then back out: the round trip ends where it began.
      const steps = 120, ks = Array.from({ length: steps + 1 }, (_, i) => kMin * (kMax / kMin) ** (i / steps));
      let open = new Set<string>([tree.rootId]);
      const first = [...open];
      for (const k of ks) open = nextOpen(tree, levels, k, open);
      expect(open.size).toBeGreaterThan(1);
      for (const k of [...ks].reverse()) open = nextOpen(tree, levels, k, open);
      expect([...open]).toEqual(first);

      // Outside each group's hysteresis band, the state is the same coming in or going out.
      const outside = (k: number) => [...levels.values()].every((l) => k <= l.kClose || k >= l.kOpen);
      for (const k of ks.filter(outside)) {
        const fromBelow = nextOpen(tree, levels, k, new Set<string>([tree.rootId]));
        const fromAbove = nextOpen(tree, levels, k, all);
        expect([...fromAbove].sort()).toEqual([...fromBelow].sort());
      }
    });
  }

  it.skipIf(!existsSync(LOCAL))("opens the largest top-level cluster first on the real wiki", () => {
    const m = createModel(JSON.parse(readFileSync(LOCAL, "utf8")));
    const layout = computeLayout(m), tree = m.tree;
    const levels = zoomLevels(tree, layout, 0.5, opts);
    const top = tree.nodes.get(tree.rootId)!.children.filter((c) => levels.has(c));
    const firstOpen = top.reduce((a, b) => (levels.get(a)!.kOpen <= levels.get(b)!.kOpen ? a : b));
    const largest = top.reduce((a, b) => (layout.get(a)!.r >= layout.get(b)!.r ? a : b));
    expect(firstOpen).toBe(largest);
  });
});

describe("fold animation step", () => {
  it("holds a settled value, so a redraw never nudges an open cluster", () => {
    for (const v of [0, 1]) expect(approach(v, v, 0.06)).toBe(v);
  });
  it("moves toward the target and lands on it", () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(0.1, 0, 0.3)).toBe(0);
  });
});
