import type { Theme } from "../contract";

/** Defaults used by the browser harness and when a variable is unset. */
export const FALLBACK_THEME: Theme = {
  background: "#1e1e1e",
  node: "#a3a3a3",
  nodeFocused: "#a882ff",
  nodeTag: "#6fb86f",
  unfiled: "#fb464c",
  line: "#3f3f3f",
  lineHighlight: "#a882ff",
  text: "#dadada",
  ring: "rgba(163,163,163,0.25)",
  font: "system-ui, sans-serif",
};

/**
 * Read the theme from Obsidian's graph-view CSS variables, so the map follows
 * the user's light/dark theme and any snippet that recolours the native graph.
 */
export function readTheme(el: HTMLElement = document.body): Theme {
  const css = getComputedStyle(el);
  // A canvas silently ignores a colour it can't parse and keeps the previous
  // one (black by default), so every value is checked before it is used.
  const v = (name: string, fallback: string) => {
    const raw = css.getPropertyValue(name).trim();
    return raw && isCanvasColour(raw) ? raw : fallback;
  };
  const node = v("--graph-node", FALLBACK_THEME.node);
  return {
    background: v("--background-primary", FALLBACK_THEME.background),
    node,
    nodeFocused: v("--graph-node-focused", v("--interactive-accent", FALLBACK_THEME.nodeFocused)),
    nodeTag: v("--graph-node-tag", FALLBACK_THEME.nodeTag),
    unfiled: v("--text-error", FALLBACK_THEME.unfiled),
    line: v("--graph-line", FALLBACK_THEME.line),
    lineHighlight: v("--graph-node-focused", v("--interactive-accent", FALLBACK_THEME.lineHighlight)),
    text: v("--graph-text", v("--text-normal", FALLBACK_THEME.text)),
    ring: v("--background-modifier-border", FALLBACK_THEME.ring),
    font: canvasFont(css.getPropertyValue("--font-interface").trim()),
  };
}

let probe: CanvasRenderingContext2D | null = null;
const ctx = () => (probe ??= document.createElement("canvas").getContext("2d"));

export function isCanvasColour(value: string): boolean {
  const c = ctx();
  if (!c) return false;
  c.fillStyle = "#010203";
  c.fillStyle = value;
  return c.fillStyle !== "#010203" || value.replace(/\s/g, "").toLowerCase() === "#010203";
}

/** The font stack, minus Obsidian's unset '??' override placeholders, if a canvas accepts it. */
export function canvasFont(stack: string): string {
  const cleaned = stack.split(",").map((s) => s.trim()).filter((s) => s && !/^['"]?\?\?['"]?$/.test(s)).join(", ");
  const c = ctx();
  if (!c || !cleaned) return FALLBACK_THEME.font;
  c.font = "12px serif";
  c.font = `12px ${cleaned}`;
  return c.font === "12px serif" ? FALLBACK_THEME.font : cleaned;
}
