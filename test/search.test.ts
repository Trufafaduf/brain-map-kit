import { describe, expect, it } from "vitest";
import { createModel } from "../src/model/graph";
import { fuzzyMatch, rank, searchItems } from "../src/ui/search";

const score = (q: string, t: string) => fuzzyMatch(q, t)?.score ?? -Infinity;

describe("fuzzyMatch", () => {
  it("matches subsequences, case-insensitively, and nothing else", () => {
    expect(fuzzyMatch("gph", "Graph Theory")?.hits).toEqual([0, 3, 4]);
    expect(fuzzyMatch("GRAPH", "graph theory")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Graph Theory")).toBeNull();
    expect(fuzzyMatch("", "Graph Theory")).toBeNull();
    expect(fuzzyMatch("aa", "a")).toBeNull();
  });

  it("finds a subsequence even when a later word start would break it", () => {
    expect(fuzzyMatch("ac", "xac a")).not.toBeNull();
  });

  it("scores contiguous runs above scattered letters", () => {
    expect(score("model", "Model Notes")).toBeGreaterThan(score("model", "Mixed Old Delta Elements Library"));
  });

  it("scores word starts above mid-word hits", () => {
    expect(score("st", "Sample Test")).toBeGreaterThan(score("st", "Pastry"));
    expect(fuzzyMatch("pt", "Pasta Tomato")?.hits).toEqual([0, 6]);
  });

  it("scores shorter titles above longer ones with the same hits", () => {
    expect(score("notes", "Notes")).toBeGreaterThan(score("notes", "Notes on a longer subject"));
  });
});

describe("rank", () => {
  const items = ["Linear Algebra", "Line Search", "Alignment", "Lineage of Ideas", "Cooking"]
    .map((title, i) => ({ id: `page:${i}`, title, folder: "" }));

  it("keeps matches only, best first, capped at the limit", () => {
    const r = rank(items, "line", 3);
    expect(r).toHaveLength(3);
    expect(r[0].title).toBe("Line Search");
    expect(r.some((x) => x.title === "Cooking")).toBe(false);
  });
});

describe("searchItems", () => {
  it("lists every node but the root, with the folder each sits in", () => {
    const m = createModel({
      pages: [
        { path: "index.md", title: "Index", type: null, tags: [] },
        { path: "alpha/alpha.md", title: "Alpha", type: null, tags: [] },
        { path: "alpha/beta/deep.md", title: "Deep", type: null, tags: [] },
      ],
      links: [],
    });
    const items = searchItems(m.tree);
    expect(items.find((i) => i.id === "root")).toBeUndefined();
    expect(items.find((i) => i.title === "Deep")?.folder).toBe("alpha/beta");
    expect(items.find((i) => i.id === "dir:alpha/beta")?.folder).toBe("alpha");
    expect(items.find((i) => i.id === "dir:alpha")?.folder).toBe("");
  });
});
