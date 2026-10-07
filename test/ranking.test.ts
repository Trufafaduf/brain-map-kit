import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawGraph } from "../src/contract";
import { DEFAULT_EXCLUDE } from "../src/contract";
import { createModel } from "../src/model/graph";

const page = (path: string, title: string) => ({ path, title, type: "concept", tags: [] });
const tiny: RawGraph = {
  pages: [
    page("index.md", "Index"),
    page("log.md", "Log"),
    page("a/a.md", "A hub"),
    page("a/x.md", "X"),
    page("a/y.md", "Y"),
    page("a/x-dashboard.md", "X dashboard"),
    page("a/sub/sub.md", "Sub hub"),
    page("a/sub/s.md", "S"),
    page("b/b.md", "B hub"),
    page("b/p.md", "P"),
    page("c/q.md", "Q"),
  ],
  links: [
    { source: "index.md", target: "a/x.md", count: 1 },
    { source: "a/x.md", target: "a/y.md", count: 3 },
    { source: "a/y.md", target: "a/x.md", count: 1 },
    { source: "a/x.md", target: "b/p.md", count: 4 },
    { source: "a/x.md", target: "c/q.md", count: 4 },
    { source: "b/p.md", target: "c/q.md", count: 1 },
    { source: "a/x.md", target: "a/x-dashboard.md", count: 9 },
    { source: "a/sub/s.md", target: "a/x.md", count: 1 },
    { source: "b/b.md", target: "a/a.md", count: 2 },
    { source: "a/a.md", target: "a/sub/sub.md", count: 1 },
    { source: "c/q.md", target: "a/sub/s.md", count: 2 },
  ],
};

describe("rankLinks", () => {
  const m = createModel(tiny);
  it("scores both directions with a mutual bonus, ties broken by inbound", () => {
    expect(m.rankLinks("page:a/x.md")).toEqual([
      { id: "page:a/y.md", title: "Y", score: 6, linksIn: 1, linksOut: 3, inbound: 3 },
      { id: "page:c/q.md", title: "Q", score: 4, linksIn: 0, linksOut: 4, inbound: 5 },
      { id: "page:b/p.md", title: "P", score: 4, linksIn: 0, linksOut: 4, inbound: 4 },
      { id: "page:a/sub/s.md", title: "S", score: 1, linksIn: 1, linksOut: 0, inbound: 2 },
    ]);
  });
  it("honours the limit", () => {
    expect(m.rankLinks("page:a/x.md", 2).map((r) => r.id)).toEqual(["page:a/y.md", "page:c/q.md"]);
  });
  it("ranks a cluster by its hub's links", () => {
    expect(m.rankLinks("dir:a").map((r) => [r.id, r.score])).toEqual([["dir:b", 2], ["dir:a/sub", 1]]);
  });
  it("leaves out excluded pages and the root, and uses the given patterns", () => {
    const loose = createModel(tiny, { exclude: [] });
    expect(loose.rankLinks("page:a/x.md").map((r) => r.id)).toEqual([
      "page:a/x-dashboard.md", "page:a/y.md", "page:c/q.md", "page:b/p.md", "page:a/sub/s.md",
    ]);
    expect(m.rankLinks("page:a/x-dashboard.md")).toEqual([
      { id: "page:a/x.md", title: "X", score: 9, linksIn: 9, linksOut: 0, inbound: 3 },
    ]);
  });
  it("returns nothing for a node without links", () => {
    expect(m.rankLinks("page:log.md")).toEqual([]);
    expect(m.rankLinks("missing")).toEqual([]);
  });
});

describe("clusterInfo", () => {
  const m = createModel(tiny);
  it("ranks entry points by links arriving from outside, leaving out the cluster itself", () => {
    expect(m.clusterInfo("dir:a").entryPoints).toEqual([
      { id: "page:a/sub/s.md", title: "S", score: 2, linksIn: 2, linksOut: 0, inbound: 2 },
      { id: "page:a/x.md", title: "X", score: 11, linksIn: 1, linksOut: 8, inbound: 3 },
    ]);
    expect(m.clusterInfo("dir:a", 1).entryPoints.map((r) => r.id)).toEqual(["page:a/sub/s.md"]);
  });
  it("treats the parent cluster as outside a sub-cluster", () => {
    expect(m.clusterInfo("dir:a/sub").entryPoints.map((r) => [r.id, r.linksIn, r.linksOut, r.score])).toEqual([
      ["page:a/sub/s.md", 2, 1, 5],
    ]);
  });
  it("weighs sibling clusters by links both ways between subtrees", () => {
    expect(m.clusterInfo("dir:a").neighbours).toEqual([
      { id: "dir:b", title: "B hub", weight: 6 },
      { id: "dir:c", title: "c", weight: 6 },
    ]);
    expect(m.clusterInfo("dir:c").neighbours).toEqual([
      { id: "dir:a", title: "A hub", weight: 6 },
      { id: "dir:b", title: "B hub", weight: 1 },
    ]);
    expect(m.clusterInfo("dir:a", 1).neighbours).toHaveLength(1);
    // Sub's only cross link is with a page of its parent, not a sibling cluster.
    expect(m.clusterInfo("dir:a/sub").neighbours).toEqual([]);
  });
  it("has nothing outside the root", () => {
    expect(m.clusterInfo("root")).toEqual({ entryPoints: [], neighbours: [] });
  });
});

describe("ranking on the synthetic fixture", () => {
  const raw: RawGraph = JSON.parse(readFileSync("fixtures/synthetic-2000.json", "utf8"));
  const m = createModel(raw);
  const res = DEFAULT_EXCLUDE.map((e) => new RegExp(e));
  const excluded = (id: string) => {
    const p = m.tree.nodes.get(id)!.path;
    return id === "root" || (!!p && res.some((r) => r.test(p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, ""))));
  };
  it("returns bounded, clean rankings for every node and cluster", () => {
    let nonEmpty = 0;
    for (const n of m.tree.nodes.values()) {
      const links = m.rankLinks(n.id, 6);
      expect(links.length).toBeLessThanOrEqual(6);
      for (const l of links) expect(l.id === n.id || excluded(l.id)).toBe(false);
      if (n.kind === "page") continue;
      const info = m.clusterInfo(n.id, 4);
      if (info.entryPoints.length) nonEmpty++;
      expect(info.entryPoints.length).toBeLessThanOrEqual(4);
      expect(info.neighbours.length).toBeLessThanOrEqual(4);
      for (const l of info.entryPoints) expect(excluded(l.id)).toBe(false);
      for (const s of info.neighbours) {
        expect(s.id).not.toBe(n.id);
        expect(m.tree.nodes.get(s.id)!.parent).toBe(n.parent);
      }
    }
    expect(nonEmpty).toBeGreaterThan(0);
  });
});
