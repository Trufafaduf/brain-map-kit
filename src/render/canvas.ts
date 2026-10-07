import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { GraphModel, Layout, Placement, Renderer, RendererEvents, Theme, VisibleGraph, ZoomOptions } from "../contract";
import { DEFAULT_SETTINGS } from "../contract";
import { FALLBACK_THEME } from "../ui/theme";
import { HUB_R, PAGE_R, smallestGroupR } from "./layout";
import { approach, nextOpen, zoomLevels, type ZoomLevel } from "./zoomlevels";

/** How long a cluster takes to fan its children out, or fold them back in. */
const FOLD_MS = 260;
const FLY_MS = 600;
/** Opacity of the root's label: readable, but quieter than the clusters'. */
const ROOT_LABEL = 0.6;

/**
 * Canvas renderer with semantic zoom. Each group opens and closes at fixed
 * zoom scales (zoomlevels.ts), so zooming in walks index → clusters →
 * sub-clusters → pages and zooming back out retraces the same steps. Children
 * fan out of their parent's dot as it opens and fold back in as it closes.
 * Zoom out stops at the scale where the whole top level fits the view, with
 * everything closed; zoom in stops once the smallest cluster is open with
 * readable page labels.
 */
export class CanvasRenderer implements Renderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private model: GraphModel | null = null;
  private layout: Layout = new Map();
  private open = new Set<string>();
  private vis: VisibleGraph = { nodes: [], rings: [], edges: [] };
  private theme: Theme = FALLBACK_THEME;
  private opts: ZoomOptions = { openPx: DEFAULT_SETTINGS.openPx, closePx: DEFAULT_SETTINGS.closePx };
  private t: ZoomTransform = zoomIdentity;
  private zoomer!: ZoomBehavior<HTMLCanvasElement, unknown>;
  private hovered: string | null = null;
  private lit: string | null = null;
  private handlers: Partial<{ [K in keyof RendererEvents]: RendererEvents[K][] }> = {};
  private frame = 0;
  private flight = 0;
  /** Open and close scales per group, recomputed with the zoom bounds. */
  private levels = new Map<string, ZoomLevel>();
  /** 0 closed .. 1 open, per group; animates toward whether it is in `open`. */
  private openness = new Map<string, number>();
  /** Key of the groups `vis` was last built from. */
  private shownKey = "";
  private lastPaint = 0;
  /** Canvas size and pixel ratio at the last resize. */
  private cssW = 0;
  private cssH = 0;
  private dpr = 0;
  private reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private focusKey = "";
  /** False until the view has fitted the graph at a real, non-zero size. */
  private fitted = false;

  mount(container: HTMLElement): void {
    this.canvas = container.createEl ? container.createEl("canvas") : container.appendChild(document.createElement("canvas"));
    this.canvas.addClass?.("brain-map-canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.ctx = this.canvas.getContext("2d")!;
    this.zoomer = zoom<HTMLCanvasElement, unknown>().on("zoom", (ev) => {
      this.t = ev.transform;
      this.updateOpen();
      this.draw();
    });
    select(this.canvas).call(this.zoomer).on("dblclick.zoom", null);
    this.canvas.addEventListener("pointermove", (ev) => this.setHover(this.pick(ev.offsetX, ev.offsetY), { x: ev.offsetX, y: ev.offsetY }));
    this.canvas.addEventListener("pointerleave", () => this.setHover(null, { x: 0, y: 0 }));
    this.canvas.addEventListener("click", (ev) => {
      const id = this.pick(ev.offsetX, ev.offsetY);
      if (id) this.emit("click", id, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey });
    });
    // Double-click a node to open its page; double-click empty space to reset the view.
    this.canvas.addEventListener("dblclick", (ev) => {
      const id = this.pick(ev.offsetX, ev.offsetY);
      if (id) this.emit("dblclick", id);
      else this.reset();
    });
    this.resize();
  }

  setGraph(model: GraphModel, layout: Layout): void {
    this.model = model;
    this.layout = layout;
    this.open = new Set([model.tree.rootId]);
    this.openness = new Map([[model.tree.rootId, 1]]);
    this.shownKey = "";
    this.vis = model.visible(this.open);
    this.fitted = false;
    this.fit();
  }

  setTheme(theme: Theme): void { this.theme = theme; this.draw(); }

  setZoom(options: ZoomOptions): void {
    this.opts = options;
    this.bound();
    this.updateOpen();
    this.draw();
  }

  /** Fly to fit a node's circle (a cluster opens once it fills the view), or centre a page. */
  flyTo(id: string): void {
    const p = this.layout.get(id), n = this.model?.tree.nodes.get(id);
    if (!p || !n || !this.canvas.clientWidth) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const want = n.kind === "page" ? Math.max(this.t.k, 3 * this.opts.openPx / Math.max(1, this.parentR(id))) : 0.45 * Math.min(w, h) / p.r;
    this.flyToward(Math.max(want, this.openK(id)), p.x, p.y);
  }

  /** A scale just past the open level of the node (if a group) and every ancestor, so a deep target lands open. */
  private openK(id: string): number {
    let k = 0;
    for (let c: string | null = id; c; c = this.model!.tree.nodes.get(c)?.parent ?? null) {
      const l = this.levels.get(c);
      if (l) k = Math.max(k, l.kOpen * 1.05);
    }
    return k;
  }

  /** Fly back to the first frame: the whole top level, every cluster closed. */
  reset(): void {
    if (!this.model || !this.canvas.clientWidth) return;
    this.lit = null;
    this.setHover(null, { x: 0, y: 0 });
    const b = this.box();
    this.flyToward(this.fitK(), (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  }

  /** Animate to scale `want`, clamped to the zoom bounds, centred on world point (tx, ty). */
  private flyToward(want: number, tx: number, ty: number): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const [k0, k1] = this.zoomer.scaleExtent();
    const k = Math.min(k1, Math.max(k0, want));
    const from = this.t, start = performance.now();
    const [fx, fy] = from.invert([w / 2, h / 2]);
    const ms = this.reduceMotion ? 1 : FLY_MS;
    cancelAnimationFrame(this.flight);
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / ms), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      // Interpolate scale geometrically and the world point at the centre linearly.
      const kk = from.k * (k / from.k) ** e;
      const cx = fx + (tx - fx) * e, cy = fy + (ty - fy) * e;
      select(this.canvas).call(this.zoomer.transform, zoomIdentity.translate(w / 2, h / 2).scale(kk).translate(-cx, -cy));
      if (u < 1) this.flight = requestAnimationFrame(step);
    };
    this.flight = requestAnimationFrame(step);
  }

  highlight(id: string | null): void { this.lit = id; this.draw(); }

  resize(): void {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    // Skip resizes that change nothing, so a layout flicker can't loop through a redraw.
    if (this.fitted && w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    // A hidden pane keeps its last view, so showing it again re-centres from a real size.
    if (this.fitted && (!w || !h)) return;
    const oldW = this.cssW, oldH = this.cssH;
    const wasOut = this.fitted && this.t.k <= this.zoomer.scaleExtent()[0] * (1 + 1e-3);
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    // Obsidian creates the view before laying out its tab, so the first fit can
    // happen at 0x0; fit again on the first resize that gives the canvas a size.
    // Fully zoomed out stays fitted; otherwise the world point at the centre stays put.
    if (!this.fitted || wasOut) this.fit();
    else this.recentre(oldW, oldH);
    this.draw();
  }

  on<K extends keyof RendererEvents>(event: K, cb: RendererEvents[K]): void {
    ((this.handlers[event] ??= []) as RendererEvents[K][]).push(cb);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.flight);
    select(this.canvas).on(".zoom", null);
    this.canvas.remove();
  }

  /** Sizes, transform and counts, for the diagnostics file. */
  debugState(): Record<string, unknown> {
    const c = this.canvas;
    return {
      canvasCss: c ? [c.clientWidth, c.clientHeight] : null,
      transform: { x: this.t.x, y: this.t.y, k: this.t.k },
      scaleExtent: this.zoomer?.scaleExtent(),
      fitted: this.fitted,
      open: [...this.open],
      levels: Object.fromEntries([...this.levels].map(([id, l]) => [id, [+l.kOpen.toFixed(4), +l.kClose.toFixed(4)]])),
      visibleNodes: this.vis.nodes.length,
      visibleEdges: this.vis.edges.length,
    };
  }

  // ------------------------------------------------------------- zoom

  /** World bounding box of the top level: every child circle of the root. */
  private box(): { minX: number; minY: number; maxX: number; maxY: number } {
    const m = this.model!;
    const ps = [m.tree.rootId, ...m.tree.nodes.get(m.tree.rootId)!.children].map((id) => this.layout.get(id)!);
    const kids = ps.length > 1 ? ps.slice(1) : ps;
    return {
      minX: Math.min(...kids.map((p) => p.x - p.r)), maxX: Math.max(...kids.map((p) => p.x + p.r)),
      minY: Math.min(...kids.map((p) => p.y - p.r)), maxY: Math.max(...kids.map((p) => p.y + p.r)),
    };
  }

  /** The scale at which the whole top level fits the view. */
  private fitK(): number {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!this.model || !w || !h) return 1;
    const b = this.box();
    return 0.92 * Math.min(w / (b.maxX - b.minX || 1), h / (b.maxY - b.minY || 1));
  }

  /**
   * Zoom and pan bounds. Out: the whole top level fits the view, no smaller.
   * In: the smallest cluster opens and its page dots reach about 20 px.
   */
  private bound(): void {
    if (!this.model || !this.canvas.clientWidth) return;
    const min = this.fitK();
    const max = Math.max(min * 2, 2 * this.opts.openPx / smallestGroupR(this.model.tree, this.layout), 20 / PAGE_R);
    // Panning stops a little past the edge of the map; at the outermost zoom,
    // where the map is smaller than the view, d3 keeps it centred.
    const b = this.box(), pad = 0.1 * Math.max(b.maxX - b.minX, b.maxY - b.minY);
    this.zoomer
      .scaleExtent([min, max])
      .translateExtent([[b.minX - pad, b.minY - pad], [b.maxX + pad, b.maxY + pad]]);
    this.levels = zoomLevels(this.model.tree, this.layout, min, this.opts);
    if (this.t.k < min || this.t.k > max) select(this.canvas).call(this.zoomer.scaleTo, Math.min(max, Math.max(min, this.t.k)));
  }

  /** Keep the world point that sat at the centre of an oldW x oldH view at the new centre. */
  private recentre(oldW: number, oldH: number): void {
    const [cx, cy] = this.t.invert([oldW / 2, oldH / 2]);
    this.bound();
    const [k0, k1] = this.zoomer.scaleExtent(), k = Math.min(k1, Math.max(k0, this.t.k));
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    select(this.canvas).call(this.zoomer.transform, zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-cx, -cy));
  }

  private fit(): void {
    if (!this.model || !this.canvas.clientWidth || !this.canvas.clientHeight) return;
    this.fitted = true;
    this.bound();
    const b = this.box();
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const t = zoomIdentity.translate(w / 2, h / 2).scale(this.fitK()).translate(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2);
    select(this.canvas).call(this.zoomer.transform, t);
  }

  /** Re-derive which groups are open from the zoom scale alone (zoomlevels.ts). */
  private updateOpen(): void {
    const m = this.model;
    if (!m) return;
    const next = nextOpen(m.tree, this.levels, this.t.k, this.open);
    if (next.size !== this.open.size || [...next].some((id) => !this.open.has(id))) {
      this.open = next;
      this.syncVisible();
    }
    this.emitFocus();
  }

  /**
   * Rebuild the visible graph from the groups drawn open: those open now plus
   * those still folding closed, so their children stay on screen until they
   * have folded back into the parent's dot.
   */
  private syncVisible(): void {
    const m = this.model!;
    const shown = new Set<string>(this.open);
    for (const [id, o] of this.openness) if (o > 0) shown.add(id);
    const key = [...shown].sort().join("|");
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.vis = m.visible(shown);
    if (this.hovered && !this.vis.nodes.includes(this.hovered)) this.setHover(null, { x: 0, y: 0 });
  }

  /** Step every group's openness toward its target. True while any is still moving. */
  private stepOpenness(dt: number): boolean {
    const m = this.model!;
    let moving = false;
    for (const id of new Set<string>([...this.open, ...this.openness.keys()])) {
      const target = this.open.has(id) ? 1 : 0, o = this.openness.get(id) ?? 0;
      const next = this.reduceMotion ? target : approach(o, target, dt / FOLD_MS);
      if (next === 0 && id !== m.tree.rootId) this.openness.delete(id);
      else this.openness.set(id, next);
      if (next !== target) moving = true;
    }
    this.syncVisible();
    return moving;
  }

  /** Emit the chain of open groups containing the centre of the view, when it changes. */
  private emitFocus(): void {
    const m = this.model;
    if (!m || !this.canvas.clientWidth) return;
    const [cx, cy] = this.t.invert([this.canvas.clientWidth / 2, this.canvas.clientHeight / 2]);
    const path: string[] = [m.tree.rootId];
    for (let id: string = m.tree.rootId; ;) {
      const next = m.tree.nodes.get(id)!.children.find((c) => {
        const p = this.layout.get(c)!;
        return this.open.has(c) && Math.hypot(p.x - cx, p.y - cy) < p.r;
      });
      if (!next) break;
      path.push(next);
      id = next;
    }
    const key = path.join("|");
    if (key !== this.focusKey) { this.focusKey = key; this.emit("focus", path); }
  }

  // ------------------------------------------------------------- picking

  private emit<K extends keyof RendererEvents>(event: K, ...args: Parameters<RendererEvents[K]>): void {
    for (const cb of this.handlers[event] ?? []) (cb as (...a: unknown[]) => void)(...args);
  }

  private parentR(id: string): number {
    const parent = this.model?.tree.nodes.get(id)?.parent;
    return parent ? this.layout.get(parent)?.r ?? 1 : 1;
  }

  private pick(sx: number, sy: number): string | null {
    const [x, y] = this.t.invert([sx, sy]);
    let best: string | null = null, bestD = Infinity;
    for (const id of this.vis.nodes) {
      const p = this.pos(id);
      if (!p || this.alpha(id) < 0.5) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= this.dotR(id) + 4 / this.t.k && d < bestD) { best = id; bestD = d; }
    }
    return best;
  }

  private setHover(id: string | null, at: { x: number; y: number }): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.canvas.style.cursor = id ? "pointer" : "";
    this.emit("hover", id, at);
    this.draw();
  }

  // ------------------------------------------------------------- painting

  /**
   * A page is a small dot; a closed cluster a dot sized by its weight, which
   * shrinks smoothly into the hub dot as the cluster opens.
   */
  private dotR(id: string): number {
    const n = this.model!.tree.nodes.get(id)!;
    if (n.kind === "root") return HUB_R * 1.5;
    if (n.kind === "page") return PAGE_R;
    const closed = Math.max(HUB_R, this.layout.get(id)!.r * 0.35), e = ease(this.openness.get(id) ?? 0);
    return closed + (HUB_R - closed) * e;
  }

  /** Product of the ancestors' openness: how far a node has faded in. */
  private alpha(id: string): number {
    const nodes = this.model!.tree.nodes;
    let a = 1;
    for (let p = nodes.get(id)!.parent; p; p = nodes.get(p)!.parent) a *= this.openness.get(p) ?? 0;
    return a;
  }

  /** Where a node is drawn this frame: pulled toward its parent's centre while the parent is part open. */
  private pos(id: string): Placement | undefined {
    const p = this.layout.get(id);
    if (!p) return undefined;
    const parent = this.model!.tree.nodes.get(id)!.parent;
    if (!parent) return p;
    const q = this.pos(parent)!, lp = this.layout.get(parent)!;
    const e = ease(this.openness.get(parent) ?? 0);
    if (e >= 1 && q === lp) return p;
    return { x: q.x + (p.x - lp.x) * e, y: q.y + (p.y - lp.y) * e, r: p.r };
  }

  private draw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.paint());
  }

  private paint(): void {
    const { ctx, canvas, theme, model } = this;
    if (!ctx || !model) return;
    const now = performance.now();
    const dt = this.lastPaint ? Math.min(64, now - this.lastPaint) : 16;
    this.lastPaint = now;
    const moving = this.stepOpenness(dt);
    const k = this.t.k;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * this.t.x, dpr * this.t.y);

    const focus = this.lit ?? this.hovered;
    const near = new Set<string>();
    if (focus) {
      near.add(focus);
      for (const e of this.vis.edges) {
        if (e.source === focus) near.add(e.target);
        if (e.target === focus) near.add(e.source);
      }
    }
    const dim = (id: string) => focus !== null && !near.has(id);
    const fade = (id: string) => this.alpha(id);

    // Rings of open groups (the root's ring is the whole map, so it is left out).
    ctx.font = `${11 / k}px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const id of this.vis.rings) {
      if (id === model.tree.rootId) continue;
      const p = this.pos(id)!, o = this.openness.get(id) ?? 0, r = p.r * ease(o);
      ctx.globalAlpha = 0.5 * fade(id) * o;
      ctx.strokeStyle = theme.ring;
      ctx.lineWidth = 1.5 / k;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.8 * fade(id) * o;
      ctx.fillStyle = theme.text;
      ctx.fillText(model.tree.nodes.get(id)!.title, p.x, p.y - r - 3 / k);
    }

    for (const e of this.vis.edges) {
      const a = this.pos(e.source), b = this.pos(e.target);
      if (!a || !b) continue;
      const hot = focus !== null && (e.source === focus || e.target === focus);
      // Lines keep their strength while their ends fan out: children start on the
      // parent's dot, so a line to the parent turns smoothly into lines to them.
      ctx.globalAlpha = focus && !hot ? 0.08 : 0.55;
      ctx.strokeStyle = hot ? theme.lineHighlight : theme.line;
      ctx.lineWidth = Math.min(6, 1 + Math.log2(e.count)) / k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    ctx.font = `${12 / k}px ${theme.font}`;
    ctx.textBaseline = "top";
    for (const id of this.vis.nodes) {
      const p = this.pos(id);
      const n = model.tree.nodes.get(id);
      if (!p || !n) continue;
      const r = this.dotR(id);
      const f = fade(id);
      ctx.globalAlpha = (dim(id) ? 0.2 : 1) * f;
      ctx.fillStyle = id === focus ? theme.nodeFocused : n.kind === "unfiled" ? theme.unfiled : theme.node;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      // Labels fade in once the dot is big enough on screen, as in Obsidian's graph.
      // Pages at the top level are labelled at every zoom, like the clusters beside them.
      const top = n.parent === model.tree.rootId;
      const labelAlpha = id === focus || n.kind !== "page" || top ? 1 : Math.min(1, Math.max(0, (r * k - 3) / 4));
      // An open cluster's name moves to its ring, so the dot's own label fades as it opens.
      // The root is always open and has no ring, so it keeps a quieter label of its own.
      const own = n.kind === "root" ? ROOT_LABEL : n.kind === "page" ? 1 : 1 - (this.openness.get(id) ?? 0);
      if (labelAlpha * own <= 0) continue;
      ctx.globalAlpha = labelAlpha * own * (dim(id) ? 0.2 : 1) * f;
      ctx.fillStyle = theme.text;
      ctx.fillText(n.title, p.x, p.y + r + 3 / k);
    }
    ctx.globalAlpha = 1;
    if (moving) this.draw();
  }
}

const ease = (u: number) => 1 - (1 - u) ** 3;
