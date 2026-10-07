import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createModel } from "../src/model/graph";
import { computeLayout } from "../src/render/layout";

const LOCAL = "fixtures/local/graph.json";
const SYNTH = "fixtures/synthetic-2000.json";

describe("nested layout", { timeout: 60000 }, () => {
  for (const file of [SYNTH, LOCAL]) {
    it.skipIf(!existsSync(file))(`places every node inside its parent, apart from its siblings, deterministically (${file})`, () => {
      const m = createModel(JSON.parse(readFileSync(file, "utf8")));
      const a = computeLayout(m), b = computeLayout(m);
      expect(a.size).toBe(m.tree.nodes.size);
      for (const n of m.tree.nodes.values()) {
        expect(a.get(n.id)).toEqual(b.get(n.id));
        if (!n.parent) continue;
        const p = a.get(n.parent)!, c = a.get(n.id)!;
        expect(Math.hypot(c.x - p.x, c.y - p.y) + c.r).toBeLessThanOrEqual(p.r + 1e-6);
      }
      // Every child clears the hub dot at its group's centre.
      for (const n of m.tree.nodes.values()) {
        if (!n.path || n.kind === "page") continue;
        const c = a.get(n.id)!;
        for (const k of n.children) {
          const p = a.get(k)!;
          expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThan(p.r);
        }
      }
      // Siblings may touch a little under the collide force, never sit on top of each other.
      for (const n of m.tree.nodes.values()) {
        const kids = n.children.map((c) => a.get(c)!);
        for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
          const p = kids[i], q = kids[j];
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan((p.r + q.r) * 0.6);
        }
      }
    });
  }
});
