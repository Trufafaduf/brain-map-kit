// Breadcrumb bar: the renderer's focus path, root first, each crumb clickable.
// Plain DOM, no Obsidian imports, so the browser harness can use it too.
import type { Renderer, Tree } from "../contract";

export class Breadcrumb {
  readonly el: HTMLElement;
  private trail: HTMLElement;
  private tree: Tree | null = null;
  private renderer: Renderer | null = null;

  constructor(parent: HTMLElement) {
    this.el = parent.appendChild(parent.ownerDocument.createElement("nav"));
    this.el.className = "brain-map-crumbs";
    this.el.setAttribute("aria-label", "Focus path");
    this.el.hidden = true;
    this.trail = this.el.appendChild(parent.ownerDocument.createElement("div"));
    this.trail.className = "brain-map-crumbs-path";
  }

  /** Follow a new renderer's focus events. The renderer and tree change on every rebuild. */
  attach(r: Renderer, tree: Tree): void {
    this.renderer = r;
    this.tree = tree;
    this.set([tree.rootId]);
    r.on("focus", (path) => { if (this.renderer === r) this.set(path); });
  }

  /** Draw the path; hidden at the root alone, where there is nowhere to go back to. */
  set(path: string[]): void {
    const doc = this.el.ownerDocument, tree = this.tree;
    this.trail.replaceChildren();
    this.el.hidden = !tree || path.length < 2;
    if (!tree) return;
    path.forEach((id, i) => {
      const n = tree.nodes.get(id);
      if (!n) return;
      if (i) {
        const s = this.trail.appendChild(doc.createElement("span"));
        s.className = "brain-map-crumb-sep";
        s.textContent = "›";
        s.setAttribute("aria-hidden", "true");
      }
      const b = this.trail.appendChild(doc.createElement("button"));
      b.className = "brain-map-crumb" + (i === path.length - 1 ? " is-current" : "");
      b.textContent = n.title;
      b.title = n.title;
      // The root crumb goes back to the first frame; any other flies to its cluster.
      b.addEventListener("click", () => { if (id === tree.rootId) this.renderer?.reset(); else this.renderer?.flyTo(id); });
    });
  }
}
