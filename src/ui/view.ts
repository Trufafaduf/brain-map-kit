import { ItemView, Notice, Scope, TFile, debounce, normalizePath, setIcon, type WorkspaceLeaf } from "obsidian";
import type { GraphModel, Renderer, SummaryMap } from "../contract";
import { createModel } from "../model/graph";
import { readGraph, scopePrefix } from "../obsidian/source";
import { computeLayout } from "../render/layout";
import { CanvasRenderer } from "../render/canvas";
import type BrainMapPlugin from "../../main";
import { Breadcrumb } from "./breadcrumb";
import { SearchBox, reveal, searchItems } from "./search";
import { readTheme } from "./theme";
import { HoverCard } from "./card";

export const VIEW_TYPE = "brain-map";

export class BrainMapView extends ItemView {
  private renderer: Renderer | null = null;
  private model: GraphModel | null = null;
  private summaries: SummaryMap = {};
  private card: HoverCard | null = null;
  private status!: HTMLElement;
  private resetBtn!: HTMLElement;
  private search!: SearchBox;
  private crumbs!: Breadcrumb;
  private observer: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: BrainMapPlugin) {
    super(leaf);
    plugin.diag("view-constructed");
  }

  /** True once onOpen has run and a renderer exists. */
  isBuilt() { return this.renderer !== null; }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Brain map"; }
  getIcon() { return "orbit"; }

  async onOpen() {
    this.plugin.diag("view-open", { contentEl: [this.contentEl.clientWidth, this.contentEl.clientHeight] });
    this.contentEl.empty();
    this.contentEl.addClass("brain-map-view");
    this.card = new HoverCard(this.contentEl, { pick: (id, mods) => this.pickFromCard(id, mods) });
    this.status = this.contentEl.createDiv({ cls: "brain-map-status" });
    this.resetBtn = this.contentEl.createEl("button", { cls: "brain-map-reset clickable-icon", attr: { "aria-label": "Reset view (Esc)" } });
    setIcon(this.resetBtn, "rotate-ccw");
    this.resetBtn.onclick = () => this.resetView();
    this.search = new SearchBox(this.contentEl, (id) => { this.card?.hide(); if (this.renderer) reveal(this.renderer, id); });
    this.crumbs = new Breadcrumb(this.contentEl);
    this.scope = new Scope(this.app.scope);
    // The scope sees keys typed in the search box too: there Escape clears the box instead of resetting the map.
    this.scope.register([], "Escape", (evt) => {
      if (evt.target === this.search.input) this.search.clear();
      else this.resetView();
      return false;
    });
    this.scope.register(["Mod"], "f", () => { this.search.focus(); return false; });
    await this.rebuild();
    // A wheel or drag moves the map under the card, so let it go.
    this.registerDomEvent(this.contentEl, "wheel", () => this.card?.hide(), { passive: true });
    this.observer = new ResizeObserver(() => this.renderer?.resize());
    this.observer.observe(this.contentEl);
    this.registerEvent(this.app.workspace.on("css-change", () => this.renderer?.setTheme(readTheme())));
    const later = debounce(() => this.rebuild(), 500, true);
    this.registerEvent(this.app.metadataCache.on("resolved", later));
  }

  /** Fly back to the first frame. Bound to the reset button, Esc and a command. */
  resetView() { this.renderer?.reset(); }

  async onClose() {
    this.observer?.disconnect();
    this.card?.destroy();
    this.renderer?.destroy();
    this.renderer = null;
  }

  async rebuild() {
    try {
      await this.build();
      this.report("built");
    } catch (e) {
      console.error("brain-map:", e);
      this.plugin.diag("build-error", { message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : "" });
      this.setStatus(`Brain map failed: ${e instanceof Error ? e.message : String(e)}. Details in the developer console (Ctrl+Shift+I).`, true);
    }
  }

  /** Write the view's state to diag.json now and again once layout settles. */
  private report(event: string) {
    const snap = (when: string) => this.plugin.diag(`${event}:${when}`, {
      contentEl: [this.contentEl.clientWidth, this.contentEl.clientHeight],
      status: this.status?.getText(),
      statusInDom: this.status ? document.body.contains(this.status) : false,
      children: Array.from(this.contentEl.children).map((c) => c.tagName.toLowerCase() + "." + c.className),
      renderer: (this.renderer as unknown as { debugState?: () => unknown })?.debugState?.() ?? null,
    });
    snap("now");
    window.setTimeout(() => snap("after-2s"), 2000);
  }

  private setStatus(text: string, error = false) {
    this.status.setText(text);
    this.status.toggleClass("is-error", error);
  }

  private async build() {
    const s = this.plugin.settings;
    const raw = readGraph(this.app, s.scopeRoot);
    if (!raw.pages.length) {
      this.plugin.diag("no-pages", { scopeRoot: s.scopeRoot, vaultFiles: this.app.vault.getMarkdownFiles().length, sample: this.app.vault.getMarkdownFiles().slice(0, 5).map((f) => f.path) });
      const msg = `No markdown files under "${s.scopeRoot}". Check the scope folder in the plugin's settings.`;
      this.setStatus(msg, true);
      new Notice(`Brain map: ${msg}`);
      return;
    }
    this.summaries = await this.loadSummaries();
    this.model = createModel(raw, { exclude: s.exclude });
    this.renderer?.destroy();
    const r = new CanvasRenderer();
    r.mount(this.contentEl);
    this.status.parentElement?.appendChild(this.status); // keep the status line and reset button above the canvas
    this.resetBtn.parentElement?.appendChild(this.resetBtn);
    this.search.el.parentElement?.appendChild(this.search.el);
    this.crumbs.el.parentElement?.appendChild(this.crumbs.el);
    this.search.setItems(searchItems(this.model.tree));
    this.crumbs.attach(r, this.model.tree);
    r.setTheme(readTheme());
    r.setZoom({ openPx: s.openPx, closePx: s.closePx });
    this.card?.setData(this.model, this.summaries);
    r.on("hover", (id, at) => this.card?.hover(id, at));
    // A page opens; a cluster flies into view, which opens it. Ctrl-click or
    // double-click a cluster to open its hub page instead.
    r.on("click", (id, mods) => {
      if (this.model?.tree.nodes.get(id)?.kind === "page" || mods.ctrl) this.openNode(id, mods.ctrl);
      else r.flyTo(id);
    });
    r.on("dblclick", (id) => this.openNode(id, false));
    r.setGraph(this.model, computeLayout(this.model));
    this.renderer = r;
    const summarised = raw.pages.filter((p) => this.summaries[p.path]).length;
    this.setStatus(`v${this.plugin.manifest.version} · ${raw.pages.length} pages · ${raw.links.length} links · ${summarised} summaries`);
  }

  private async loadSummaries(): Promise<SummaryMap> {
    const path = normalizePath(this.plugin.settings.sidecarPath);
    try {
      if (!(await this.app.vault.adapter.exists(path))) return {};
      return JSON.parse(await this.app.vault.adapter.read(path)) as SummaryMap;
    } catch (e) {
      console.warn("brain-map: could not read summaries", e);
      return {};
    }
  }

  /** A hover-card row: a click flies there and highlights it, ctrl-click opens it as a page would. */
  private pickFromCard(id: string, mods: { ctrl: boolean }) {
    if (mods.ctrl) { this.openNode(id, false); return; }
    // The map moves under a still pointer, so the card would describe a node no longer there.
    this.card?.hide();
    this.renderer?.flyTo(id);
    this.renderer?.highlight(id);
  }

  // Not named "open": that would override View.open(), which Obsidian calls to attach the view.
  private openNode(id: string, newTab: boolean) {
    const n = this.model?.tree.nodes.get(id);
    if (!n?.path) return;
    const file = this.app.vault.getAbstractFileByPath(scopePrefix(this.plugin.settings.scopeRoot) + n.path);
    if (!(file instanceof TFile)) return;
    // Never navigate the map's own tab away: reuse a note tab, or open a new one.
    const reuse = newTab ? null : this.app.workspace.getLeavesOfType("markdown")[0];
    (reuse ?? this.app.workspace.getLeaf("tab")).openFile(file);
  }
}
