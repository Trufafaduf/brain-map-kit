// Search box: fuzzy-find a node by title and fly to it. Plain DOM, no Obsidian
// imports, so the browser harness can use it too.
import type { Renderer, Tree } from "../contract";

export interface SearchItem { id: string; title: string; folder: string }
export interface FuzzyHit { score: number; hits: number[] }

const isWord = (c: string) => /[\p{L}\p{N}]/u.test(c);

/** Whether q from index `qi` on is a subsequence of t from index `ti` on. */
function fits(q: string, qi: number, t: string, ti: number): boolean {
  for (; qi < q.length; qi++, ti++) if ((ti = t.indexOf(q[qi], ti)) < 0) return false;
  return true;
}

/**
 * Subsequence match of `query` in `text`, case-insensitive; null if it isn't one.
 * Each matched char scores 1, plus 2 when it continues a run and 1.5 when it
 * starts a word; long titles and late starts cost a little. Tries every start
 * of the first char, matching greedily from there, and keeps the best.
 */
export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim(), t = text.toLowerCase();
  if (!q) return null;
  let best: FuzzyHit | null = null;
  for (let s = t.indexOf(q[0]); s >= 0; s = t.indexOf(q[0], s + 1)) {
    const hits: number[] = [];
    let score = 0, i = s;
    for (const ch of q) {
      let j = t.indexOf(ch, i);
      if (j < 0) { hits.length = 0; break; }
      const prev = hits.length ? hits[hits.length - 1] : -2;
      // Off a run, jump to a later word start for this char if the rest of the query still fits after it.
      if (j !== prev + 1) {
        for (let w = j; w >= 0; w = t.indexOf(ch, w + 1)) {
          if ((w === 0 || !isWord(t[w - 1])) && fits(q, hits.length + 1, t, w + 1)) { j = w; break; }
        }
      }
      hits.push(j);
      score += 1 + (j === prev + 1 ? 2 : 0) + (j === 0 || !isWord(t[j - 1]) ? 1.5 : 0);
      i = j + 1;
    }
    if (hits.length !== q.length) continue;
    score -= 0.02 * t.length + 0.05 * s;
    if (!best || score > best.score) best = { score, hits };
  }
  return best;
}

/** The best `limit` items for `query`, best first; ties go to the shorter title. */
export function rank(items: readonly SearchItem[], query: string, limit = 8): (SearchItem & FuzzyHit)[] {
  const out: (SearchItem & FuzzyHit)[] = [];
  for (const it of items) {
    const m = fuzzyMatch(query, it.title);
    if (m) out.push({ ...it, ...m });
  }
  return out.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, limit);
}

/** Every node but the root, with the folder it sits in for display. */
export function searchItems(tree: Tree): SearchItem[] {
  const items: SearchItem[] = [];
  for (const n of tree.nodes.values()) {
    if (n.id === tree.rootId) continue;
    const at = n.kind === "page" ? n.path ?? "" : n.folder ?? "";
    items.push({ id: n.id, title: n.title, folder: at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "" });
  }
  return items;
}

const flashes = new WeakMap<Renderer, number>();

/** Fly to a node, opening its ancestors, and highlight it briefly; the next hover clears it. */
export function reveal(r: Renderer, id: string, ms = 2100): void {
  if (!flashes.has(r)) r.on("hover", (h) => { if (h && flashes.get(r)) { window.clearTimeout(flashes.get(r)); flashes.set(r, 0); r.highlight(null); } });
  window.clearTimeout(flashes.get(r));
  r.flyTo(id);
  r.highlight(id);
  flashes.set(r, window.setTimeout(() => { flashes.set(r, 0); r.highlight(null); }, ms));
}

/** The input and its result list. `onPick` gets the chosen node id. */
export class SearchBox {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private list: HTMLElement;
  private items: SearchItem[] = [];
  private shown: SearchItem[] = [];
  private sel = 0;

  constructor(parent: HTMLElement, private onPick: (id: string) => void) {
    const doc = parent.ownerDocument;
    this.el = parent.appendChild(doc.createElement("div"));
    this.el.className = "brain-map-search";
    this.input = this.el.appendChild(doc.createElement("input"));
    Object.assign(this.input, { type: "search", placeholder: "Find a page…", spellcheck: false });
    this.input.setAttribute("aria-label", "Find a page");
    this.list = this.el.appendChild(doc.createElement("div"));
    this.list.className = "brain-map-search-results";
    this.list.setAttribute("role", "listbox");
    this.input.addEventListener("input", () => { this.sel = 0; this.update(); });
    this.input.addEventListener("focus", () => this.update());
    this.input.addEventListener("blur", () => { this.list.replaceChildren(); this.list.hidden = true; });
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.list.hidden = true;
  }

  setItems(items: SearchItem[]): void { this.items = items; this.update(); }

  focus(): void { this.input.focus(); this.input.select(); }

  /** Empty the box and give focus back to the map. */
  clear(): void {
    this.input.value = "";
    this.input.blur();
    this.update();
  }

  private key(e: KeyboardEvent): void {
    const n = this.shown.length;
    if (e.key === "ArrowDown" && n) this.sel = (this.sel + 1) % n;
    else if (e.key === "ArrowUp" && n) this.sel = (this.sel - 1 + n) % n;
    else if (e.key === "Enter" && n) this.pick(this.shown[this.sel].id);
    else if (e.key === "Escape") this.clear();
    else return;
    // Keep these keys from the map's own bindings (Escape there resets the view).
    e.preventDefault();
    e.stopPropagation();
    if (e.key.startsWith("Arrow")) this.update();
  }

  private pick(id: string): void {
    this.clear();
    this.onPick(id);
  }

  private update(): void {
    const doc = this.el.ownerDocument;
    const focused = doc.activeElement === this.input;
    this.shown = focused ? rank(this.items, this.input.value) : [];
    this.list.replaceChildren();
    this.list.hidden = !this.shown.length;
    this.shown.forEach((it, i) => {
      const row = this.list.appendChild(doc.createElement("div"));
      row.className = "brain-map-search-item" + (i === this.sel ? " is-selected" : "");
      row.setAttribute("role", "option");
      const title = row.appendChild(doc.createElement("span"));
      title.className = "brain-map-search-title";
      const hits = new Set((it as SearchItem & FuzzyHit).hits);
      // Bold the matched characters, grouped into runs.
      let run = "", bold = false;
      const flush = () => { if (!run) return; const s = title.appendChild(doc.createElement(bold ? "b" : "span")); s.textContent = run; run = ""; };
      for (let j = 0; j < it.title.length; j++) { if (hits.has(j) !== bold) { flush(); bold = hits.has(j); } run += it.title[j]; }
      flush();
      if (it.folder) {
        const f = row.appendChild(doc.createElement("span"));
        f.className = "brain-map-search-folder";
        f.textContent = it.folder;
      }
      // mousedown, not click: the input's blur would empty the list before a click lands.
      row.addEventListener("mousedown", (e) => { e.preventDefault(); this.pick(it.id); });
      row.addEventListener("mousemove", () => { if (this.sel !== i) { this.sel = i; this.update(); } });
    });
  }
}
