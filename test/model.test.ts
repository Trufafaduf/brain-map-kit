import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RawGraph } from "../src/contract";
import { createModel } from "../src/model/graph";

const load = (p: string): RawGraph => JSON.parse(readFileSync(p, "utf8"));
const synthetic = load("fixtures/synthetic-2000.json");
const LOCAL = "fixtures/local/graph.json";
const SUMMARIES = "fixtures/local/summaries.json";

const tiny: RawGraph = {
  pages: [
    { path: "index.md", title: "Index", type: "index", tags: [] },
    { path: "log.md", title: "Log", type: "log", tags: [] },
    { path: "stray.md", title: "Stray", type: "concept", tags: [] },
    { path: "a/a.md", title: "A hub", type: "concept", tags: [] },
    { path: "a/x.md", title: "X", type: "concept", tags: [] },
    { path: "a/b/b.md", title: "B hub", type: "concept", tags: [] },
    { path: "a/b/y.md", title: "Y", type: "concept", tags: [] },
    { path: "c/z.md", title: "Z", type: "concept", tags: [] },
  ],
  links: [
    { source: "index.md", target: "a/a.md", count: 1 },
    { source: "a/x.md", target: "a/b/y.md", count: 2 },
    { source: "a/b/y.md", target: "c/z.md", count: 3 },
    { source: "a/a.md", target: "a/b/y.md", count: 1 },
    { source: "a/x.md", target: "a/x.md", count: 5 },
  ],
};

describe("tree", () => {
  const { tree } = createModel(tiny);
  it("roots at index.md with folders, log and unfiled beneath", () => {
    expect(tree.nodes.get("root")!.path).toBe("index.md");
    expect(tree.nodes.get("root")!.children).toEqual(["dir:a", "dir:c", "unfiled", "page:log.md"]);
    expect(tree.nodes.get("unfiled")!.children).toEqual(["page:stray.md"]);
  });
  it("makes the hub the cluster node, not a leaf", () => {
    expect(tree.byPath.get("a/a.md")).toBe("dir:a");
    expect(tree.nodes.get("dir:a")!.children).toEqual(["dir:a/b", "page:a/x.md"]);
    expect(tree.nodes.get("dir:c")!.path).toBeNull();
    expect(tree.nodes.get("dir:c")!.title).toBe("c");
  });
  it("takes a <name>-<folder>.md page as the hub when <folder>.md is missing", () => {
    const t = createModel({
      pages: [
        { path: "index.md", title: "Index", type: "index", tags: [] },
        { path: "c/lessons/c-lessons.md", title: "Lessons hub", type: "concept", tags: [] },
        { path: "c/lessons/one.md", title: "One", type: "concept", tags: [] },
        { path: "c/notes/a-notes.md", title: "A", type: "concept", tags: [] },
        { path: "c/notes/b-notes.md", title: "B", type: "concept", tags: [] },
      ],
      links: [],
    }).tree;
    expect(t.nodes.get("dir:c/lessons")!.path).toBe("c/lessons/c-lessons.md");
    expect(t.nodes.get("dir:c/lessons")!.title).toBe("Lessons hub");
    expect(t.nodes.get("dir:c/lessons")!.children).toEqual(["page:c/lessons/one.md"]);
    // Two candidates: ambiguous, so no hub.
    expect(t.nodes.get("dir:c/notes")!.path).toBeNull();
  });
  it("counts weight and depth", () => {
    expect(tree.nodes.get("dir:a")!.weight).toBe(4);
    expect(tree.nodes.get("root")!.weight).toBe(8);
    expect(tree.nodes.get("page:a/b/y.md")!.depth).toBe(3);
  });
});

describe("visible", () => {
  const m = createModel(tiny);
  it("shows only the index when nothing is open", () => {
    expect(m.visible(new Set()).nodes).toEqual(["root"]);
  });
  it("lifts edges to closed clusters and drops self-links", () => {
    const v = m.visible(new Set(["root"]));
    expect(v.nodes).toEqual(["root", "dir:a", "dir:c", "unfiled", "page:log.md"]);
    expect(v.rings).toEqual(["root"]);
    expect(v.edges).toContainEqual({ source: "dir:a", target: "dir:c", count: 3 });
    expect(v.edges).toContainEqual({ source: "root", target: "dir:a", count: 1 });
    expect(v.edges.some((e) => e.source === e.target)).toBe(false);
  });
  it("keeps an open cluster's hub as a visible node", () => {
    const v = m.visible(new Set(["root", "dir:a"]));
    expect(v.nodes).toContain("dir:a");
    expect(v.rings).toContain("dir:a");
    expect(v.edges).toContainEqual({ source: "page:a/x.md", target: "dir:a/b", count: 2 });
    expect(v.edges).toContainEqual({ source: "dir:a", target: "dir:a/b", count: 1 });
  });
  it("ignores open clusters under a closed ancestor", () => {
    expect(m.visible(new Set(["root", "dir:a/b"])).nodes).not.toContain("page:a/b/y.md");
  });
});

describe("fixtures", () => {
  it("conserves link totals when fully open (synthetic)", () => {
    const m = createModel(synthetic);
    const all = new Set([...m.tree.nodes.values()].filter((n) => n.kind !== "page").map((n) => n.id));
    const sum = (es: { count: number }[]) => es.reduce((s, e) => s + e.count, 0);
    expect(sum(m.visible(all).edges)).toBe(sum(m.edges));
  });
  it.skipIf(!existsSync(LOCAL))("real wiki has no unfiled pages and every folder is a cluster", () => {
    const m = createModel(load(LOCAL));
    expect(m.tree.nodes.has("unfiled")).toBe(false);
    expect([...m.tree.nodes.values()].filter((n) => n.kind === "page").length).toBeGreaterThan(150);
  });
  it.skipIf(!existsSync(LOCAL) || !existsSync(SUMMARIES))("real wiki: every node the map can show has a written summary", () => {
    const m = createModel(load(LOCAL));
    const summaries = JSON.parse(readFileSync(SUMMARIES, "utf8")) as Record<string, unknown>;
    const missing = [...m.tree.nodes.values()].filter((n) => !n.path || !summaries[n.path]).map((n) => n.path ?? n.id);
    expect(missing).toEqual([]);
  });
});
