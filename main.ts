import { Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import { DEFAULT_SETTINGS, type BrainMapSettings } from "./src/contract";
import { BrainMapView, VIEW_TYPE } from "./src/ui/view";

declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

export default class BrainMapPlugin extends Plugin {
  settings: BrainMapSettings = { ...DEFAULT_SETTINGS };

  private diagLog: unknown[] = [];

  /**
   * Append an event to diag.json in the plugin's own folder, so a blank or
   * broken view can be diagnosed without the developer console. Keeps the last 40.
   */
  async diag(event: string, data: Record<string, unknown> = {}) {
    this.diagLog.push({ at: new Date().toISOString(), event, ...data });
    this.diagLog = this.diagLog.slice(-40);
    try {
      await this.app.vault.adapter.write(`${this.manifest.dir}/diag.json`, JSON.stringify({ build: BUILD, version: this.manifest.version, log: this.diagLog }, null, 1));
    } catch (e) {
      console.warn("brain-map: could not write diag.json", e);
    }
  }

  async onload() {
    console.log(`brain-map ${this.manifest.version} loaded, build ${BUILD}`);
    this.registerDomEvent(window, "error", (ev) => {
      if (String(ev.filename ?? "").includes("brain-map") || String(ev.error?.stack ?? "").includes("brain-map")) {
        this.diag("window-error", { message: ev.message, stack: String(ev.error?.stack ?? "") });
      }
    });
    await this.loadSettings();
    await this.diag("load", { settings: this.settings, obsidian: (window as unknown as { app?: { appVersion?: string } }).app ? "ok" : "no app" });
    this.registerView(VIEW_TYPE, (leaf) => new BrainMapView(leaf, this));
    this.addRibbonIcon("orbit", "Open brain map", () => this.activate());
    this.addCommand({ id: "open", name: "Open brain map", callback: () => this.activate() });
    this.addCommand({ id: "reset", name: "Reset brain map view", callback: () => this.views().forEach((v) => v.resetView()) });
    this.addCommand({ id: "rebuild", name: "Rebuild brain map", callback: () => this.views().forEach((v) => v.rebuild()) });
    this.addSettingTab(new BrainMapSettingTab(this.app, this));
  }

  views(): BrainMapView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v): v is BrainMapView => v instanceof BrainMapView);
  }

  /**
   * Show the map. A live map tab is revealed; any other tab of this type (one
   * Obsidian restored before the plugin loaded, or deferred and never built)
   * is closed and replaced, since revealing it would show an empty view.
   */
  async activate() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    const live = leaves.find((l) => l.view instanceof BrainMapView && (l.view as BrainMapView).isBuilt());
    await this.diag("activate", {
      leaves: leaves.map((l) => ({ view: l.view?.constructor?.name, type: l.view?.getViewType?.(), built: l.view instanceof BrainMapView ? (l.view as BrainMapView).isBuilt() : false })),
      reuse: !!live,
    });
    if (live) { await workspace.revealLeaf(live); return; }
    for (const l of leaves) l.detach();
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
    await this.diag("activated", { view: leaf.view?.constructor?.name, built: leaf.view instanceof BrainMapView ? (leaf.view as BrainMapView).isBuilt() : false });
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) ?? {}) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.views().forEach((v) => v.rebuild());
  }
}

class BrainMapSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BrainMapPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const text = (name: string, desc: string, key: "scopeRoot" | "sidecarPath") =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(s[key]).onChange(async (v) => { s[key] = v.trim(); await this.plugin.saveSettings(); }));
    text("Scope folder", "Vault folder the map covers. Notes outside it are never read.", "scopeRoot");
    text("Summaries file", "Vault path of the hover-summary sidecar (JSON).", "sidecarPath");
  }
}
