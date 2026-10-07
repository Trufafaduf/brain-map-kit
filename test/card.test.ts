import { describe, expect, it } from "vitest";
import type { RawGraph } from "../src/contract";
import { createModel } from "../src/model/graph";
import { cardContent, placeCard } from "../src/ui/card";

const tiny: RawGraph = {
  pages: [
    { path: "index.md", title: "Index", type: "index", tags: [] },
    { path: "a/a.md", title: "A hub", type: "concept", tags: [] },
    { path: "a/x.md", title: "X", type: "concept", tags: [] },
    { path: "a/b/b.md", title: "B hub", type: "concept", tags: [] },
    { path: "a/b/y.md", title: "Y", type: null, tags: [] },
    { path: "c/z.md", title: "Z", type: "entity", tags: [] },
  ],
  links: [
    { source: "a/x.md", target: "a/b/y.md", count: 2 },
    { source: "a/b/y.md", target: "c/z.md", count: 3 },
  ],
};

describe("cardContent", () => {
  it("shows a page's type, ancestors, fallback summary and counts, hiding empty sections", () => {
    const m = createModel(tiny);
    const c = cardContent(m, {}, "page:a/b/y.md")!;
    expect(c.badge).toBe("page");
    expect(c.crumbs).toEqual(["A hub", "B hub"]);
    expect(c.summary).toMatch(/^No summary yet/);
    expect(c.sections.map((s) => s.label)).toEqual(["Top links"]);
    expect([c.inbound, c.outbound]).toEqual([2, 3]);
    m.rankLinks = () => [];
    expect(cardContent(m, {}, "page:a/b/y.md")!.sections).toEqual([]);
  });

  it("uses the sidecar summary and labels clusters with their page count", () => {
    const c = cardContent(createModel(tiny), { "a/a.md": { summary: "S", hash: "", updated: "" } }, "dir:a")!;
    expect(c.badge).toBe("cluster · 4 pages");
    expect(c.crumbs).toEqual([]);
    expect(c.summary).toBe("S");
  });

  it("falls back to the largest members for a cluster with no summary", () => {
    expect(cardContent(createModel(tiny), {}, "dir:a")!.summary).toBe("4 pages: B hub, X");
  });

  it("turns rankings into rows once they exist", () => {
    const m = createModel(tiny);
    m.rankLinks = () => [{ id: "page:c/z.md", title: "Z", score: 3, linksIn: 0, linksOut: 3, inbound: 3 }];
    m.clusterInfo = () => ({ entryPoints: [], neighbours: [{ id: "dir:c", title: "c", weight: 3 }] });
    expect(cardContent(m, {}, "page:a/b/y.md")!.sections).toEqual([{ label: "Top links", rows: [{ id: "page:c/z.md", title: "Z", meta: "0 in · 3 out" }] }]);
    expect(cardContent(m, {}, "dir:a")!.sections).toEqual([{ label: "Linked clusters", rows: [{ id: "dir:c", title: "c", meta: "3 links" }] }]);
  });

  it("returns null for an unknown id", () => {
    expect(cardContent(createModel(tiny), {}, "page:nope.md")).toBeNull();
  });
});

describe("placeCard", () => {
  const view = { w: 800, h: 600 }, card = { w: 300, h: 200 };
  it("sits below right of the cursor when there is room", () => {
    expect(placeCard({ x: 100, y: 100 }, card, view)).toEqual({ left: 114, top: 114 });
  });
  it("flips left and up near the far edges", () => {
    expect(placeCard({ x: 700, y: 550 }, card, view)).toEqual({ left: 386, top: 336 });
  });
  it("clamps inside the view when neither side fits", () => {
    expect(placeCard({ x: 150, y: 150 }, { w: 300, h: 500 }, { w: 400, h: 520 })).toEqual({ left: 8, top: 8 });
  });
});
