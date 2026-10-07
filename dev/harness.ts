// Browser harness: runs the model and renderer on a fixture with no Obsidian.
//   npm run harness, then open http://localhost:8000/dev/
// Summaries load from fixtures/local/summaries.json when present.
import type { GraphModel, Renderer, SummaryMap } from "../src/contract";
import { createModel } from "../src/model/graph";
import { computeLayout } from "../src/render/layout";
import { CanvasRenderer } from "../src/render/canvas";
import { Breadcrumb } from "../src/ui/breadcrumb";
import { SearchBox, reveal, searchItems } from "../src/ui/search";
import { FALLBACK_THEME } from "../src/ui/theme";
import { HoverCard } from "../src/ui/card";

const $ = (id: string) => document.getElementById(id)!;
let renderer: Renderer | null = null;
// No pages to open here, so ctrl-click on a card row only flies too.
const card = new HoverCard($("map"), { pick: (id, mods) => { renderer?.flyTo(id); if (!mods.ctrl) renderer?.highlight(id); } });
const search = new SearchBox(document.body, (id) => { if (renderer) reveal(renderer, id); });
const crumbs = new Breadcrumb(document.body);

async function json<T>(url: string, fallback: T): Promise<T> {
  try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : fallback; } catch { return fallback; }
}

async function load(url: string) {
  const raw = await json(url, { pages: [], links: [] });
  if (!raw.pages.length) { $("status").textContent = `no fixture at ${url}`; return; }
  const summaries = await json<SummaryMap>("../fixtures/local/summaries.json", {});
  const t0 = performance.now();
  const model = createModel(raw);
  const layout = computeLayout(model);
  $("status").textContent = `${raw.pages.length} pages, model + layout ${Math.round(performance.now() - t0)} ms`;
  renderer?.destroy();
  const r = new CanvasRenderer();
  r.mount($("map"));
  r.setTheme(FALLBACK_THEME);
  if (new URLSearchParams(location.search).has("stub")) stubRankings(model);
  card.setData(model, summaries);
  r.on("hover", (id, at) => card.hover(id, at));
  r.on("click", (id) => { if (model.tree.nodes.get(id)!.kind !== "page") r.flyTo(id); });
  search.setItems(searchItems(model.tree));
  crumbs.attach(r, model.tree);
  r.setGraph(model, layout);
  renderer = r;
  (window as unknown as { brainMap: unknown }).brainMap = { model, layout, renderer: r };
}

/** ?stub=1: crude rankings from raw edges, to check the card's layout before the real ones exist. */
function stubRankings(model: GraphModel) {
  const title = (id: string) => model.tree.nodes.get(id)?.title ?? id;
  const near = (id: string) => model.edges.filter((e) => e.source === id || e.target === id)
    .map((e) => e.source === id ? e.target : e.source).filter((v, i, a) => a.indexOf(v) === i);
  model.rankLinks = (id, limit = 6) => near(id).slice(0, limit)
    .map((o) => ({ id: o, title: title(o), score: 1, linksIn: 1, linksOut: 1, inbound: model.inbound(o) }));
  model.clusterInfo = (id, limit = 6) => {
    const kids = model.tree.nodes.get(id)?.children ?? [];
    return {
      entryPoints: kids.filter((k) => model.tree.nodes.get(k)?.kind === "page").slice(0, limit)
        .map((k) => ({ id: k, title: title(k), score: 1, linksIn: model.inbound(k), linksOut: 0, inbound: model.inbound(k) })),
      neighbours: kids.filter((k) => model.tree.nodes.get(k)?.kind === "cluster").slice(0, 3).map((k) => ({ id: k, title: title(k), weight: 3 })),
    };
  };
}

$("fixture").addEventListener("change", (e) => load((e.target as HTMLSelectElement).value));
// Resize like the plugin view does. ?hidden=1 mounts into a 0x0 container and
// reveals it later, reproducing Obsidian creating the view before laying it out.
new ResizeObserver(() => renderer?.resize()).observe($("map"));
if (new URLSearchParams(location.search).has("hidden")) {
  $("map").style.display = "none";
  setTimeout(() => { $("map").style.display = ""; }, 500);
}
load((document.getElementById("fixture") as HTMLSelectElement).value);

$("reset").addEventListener("click", () => renderer?.reset());
addEventListener("keydown", (e) => {
  if (e.key === "Escape") renderer?.reset();
  if (e.key === "f" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); search.focus(); }
});
