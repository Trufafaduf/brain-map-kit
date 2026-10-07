// The hover card: plain DOM with no obsidian imports, so the browser harness
// shows exactly what the plugin view shows.
import type { GraphModel, SummaryMap } from "../contract";

/** How long the card waits before hiding, so the pointer can cross onto it. */
export const HIDE_DELAY_MS = 250;
const GAP = 14, MARGIN = 8, LIMIT = 6;

export interface CardRow { id: string; title: string; meta: string }
export interface CardSection { label: string; rows: CardRow[] }

export interface CardContent {
  title: string;
  badge: string;
  /** Ancestor titles below the root, outermost first. */
  crumbs: string[];
  summary: string;
  /** Only non-empty sections, so the card works before rankings exist. */
  sections: CardSection[];
  inbound: number;
  outbound: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** For a node with no written summary: its page count and its largest members. */
export function fallbackSummary(model: GraphModel, id: string): string {
  const tree = model.tree, n = tree.nodes.get(id)!;
  if (n.kind === "page") return "No summary yet. Run /map-summaries to write one.";
  const count = plural(n.weight, "page");
  const top = n.children.map((c) => tree.nodes.get(c)!).sort((a, b) => b.weight - a.weight).slice(0, 3).map((c) => c.title);
  return top.length ? `${count}: ${top.join(", ")}` : count;
}

/** Everything the card shows for a node, kept apart from the DOM so it can be tested. */
export function cardContent(model: GraphModel, summaries: SummaryMap, id: string): CardContent | null {
  const n = model.tree.nodes.get(id);
  if (!n) return null;
  const crumbs: string[] = [];
  for (let p = n.parent; p && p !== model.tree.rootId; p = model.tree.nodes.get(p)?.parent ?? null) {
    crumbs.unshift(model.tree.nodes.get(p)!.title);
  }
  const sections: CardSection[] = [];
  if (n.kind === "page") {
    sections.push({ label: "Top links", rows: model.rankLinks(id, LIMIT).map((l) => ({ id: l.id, title: l.title, meta: `${l.linksIn} in · ${l.linksOut} out` })) });
  } else {
    const info = model.clusterInfo(id, LIMIT);
    sections.push({ label: "Entry points", rows: info.entryPoints.map((l) => ({ id: l.id, title: l.title, meta: `${l.linksIn} in` })) });
    sections.push({ label: "Linked clusters", rows: info.neighbours.map((c) => ({ id: c.id, title: c.title, meta: plural(c.weight, "link") })) });
  }
  return {
    title: n.title,
    badge: n.kind === "page" ? n.type ?? "page" : `${n.kind === "root" ? "index" : "cluster"} · ${plural(n.weight, "page")}`,
    crumbs,
    summary: (n.path ? summaries[n.path]?.summary : undefined) ?? fallbackSummary(model, id),
    sections: sections.filter((s) => s.rows.length),
    inbound: model.inbound(id),
    outbound: model.outbound(id),
  };
}

/** Top-left for a card of size (w, h) near the cursor: flipped left of or above it near an edge, then clamped. */
export function placeCard(at: { x: number; y: number }, card: { w: number; h: number }, view: { w: number; h: number }): { left: number; top: number } {
  const x = at.x + GAP + card.w > view.w - MARGIN ? at.x - GAP - card.w : at.x + GAP;
  const y = at.y + GAP + card.h > view.h - MARGIN ? at.y - GAP - card.h : at.y + GAP;
  return {
    left: Math.max(MARGIN, Math.min(x, view.w - card.w - MARGIN)),
    top: Math.max(MARGIN, Math.min(y, view.h - card.h - MARGIN)),
  };
}

export interface HoverCardOptions {
  /** A row was clicked; ctrl is true for ctrl- or cmd-click. */
  pick: (id: string, mods: { ctrl: boolean }) => void;
}

/** The card element plus its show/hide timing. Feed it the renderer's hover events. */
export class HoverCard {
  readonly el: HTMLElement;
  private model: GraphModel | null = null;
  private summaries: SummaryMap = {};
  private shown: string | null = null;
  private over = false;
  private timer: number | null = null;

  constructor(private container: HTMLElement, private options: HoverCardOptions) {
    this.el = container.ownerDocument.createElement("div");
    this.el.className = "brain-map-tip";
    this.el.style.display = "none";
    container.appendChild(this.el);
    this.el.addEventListener("pointerenter", () => { this.over = true; this.cancel(); });
    this.el.addEventListener("pointerleave", () => { this.over = false; this.hideSoon(); });
  }

  setData(model: GraphModel, summaries: SummaryMap) {
    this.model = model;
    this.summaries = summaries;
    this.hide();
  }

  /** Renderer hover: a node shows now; null hides after a delay unless the pointer is on the card. */
  hover(id: string | null, at: { x: number; y: number }) {
    if (!id) { if (!this.over) this.hideSoon(); return; }
    this.cancel();
    if (id !== this.shown) this.show(id, at);
  }

  hide() {
    this.cancel();
    this.shown = null;
    this.over = false;
    this.el.style.display = "none";
  }

  destroy() { this.cancel(); this.el.remove(); }

  private show(id: string, at: { x: number; y: number }) {
    const c = this.model && cardContent(this.model, this.summaries, id);
    if (!c) { this.hide(); return; }
    this.shown = id;
    this.render(c);
    this.el.style.display = "";
    const view = { w: this.container.clientWidth, h: this.container.clientHeight };
    const pos = placeCard(at, { w: this.el.offsetWidth, h: this.el.offsetHeight }, view);
    this.el.style.left = `${pos.left}px`;
    this.el.style.top = `${pos.top}px`;
  }

  private render(c: CardContent) {
    const doc = this.el.ownerDocument;
    const div = (cls: string, text?: string, parent: HTMLElement = this.el) => {
      const d = doc.createElement("div");
      d.className = cls;
      if (text !== undefined) d.textContent = text;
      parent.appendChild(d);
      return d;
    };
    this.el.replaceChildren();
    if (c.crumbs.length) div("brain-map-tip-crumbs", c.crumbs.join(" › "));
    const head = div("brain-map-tip-head");
    div("brain-map-tip-title", c.title, head);
    div("brain-map-tip-badge", c.badge, head);
    div("brain-map-tip-body", c.summary);
    for (const s of c.sections) {
      div("brain-map-tip-label", s.label);
      const list = div("brain-map-tip-rows");
      for (const r of s.rows) {
        const row = div("brain-map-tip-row", undefined, list);
        row.title = "Click to fly there, ctrl-click to open";
        div("brain-map-tip-row-title", r.title, row);
        div("brain-map-tip-row-meta", r.meta, row);
        row.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.hide();
          this.options.pick(r.id, { ctrl: ev.ctrlKey || ev.metaKey });
        });
      }
    }
    div("brain-map-tip-counts", `Links: ${c.inbound} in · ${c.outbound} out`);
  }

  private hideSoon() {
    if (this.timer !== null || !this.shown) return;
    this.timer = window.setTimeout(() => { this.timer = null; this.hide(); }, HIDE_DELAY_MS);
  }

  private cancel() {
    if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
  }
}
