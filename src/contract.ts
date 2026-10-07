// The shared contract. Every module codes against these types and nothing else
// from another module. Change this file only through the lead.
//
// Paths are relative to the scope root (the wiki folder), with forward slashes
// and the .md extension: "economics/micro/micro.md". The Obsidian
// adapter strips the scope prefix; fixture files are written that way already.

// ---------------------------------------------------------------- raw input

/** One markdown file inside the scope. */
export interface RawPage {
  path: string;
  /** Frontmatter `title`, else the basename without .md. */
  title: string;
  /** Frontmatter `type` (source | entity | concept | ...), or null. */
  type: string | null;
  tags: string[];
}

/** Resolved links from one page to another, both inside the scope. */
export interface RawLink {
  source: string;
  target: string;
  /** How many times source links target (Obsidian's resolvedLinks count). */
  count: number;
}

/**
 * The graph as read from a vault. The Obsidian adapter (src/obsidian/source.ts)
 * and the fixture files (scripts/dump_fixture.py) both produce exactly this.
 */
export interface RawGraph {
  pages: RawPage[];
  links: RawLink[];
}

// ---------------------------------------------------------------- tree

/**
 * root     the scope's index.md (id "root"). Its children are the top-level
 *          folders, plus "unfiled" when needed.
 * cluster  a folder (id "dir:<folder path>"). Labelled by its hub, the page
 *          whose basename equals the folder name; the hub is the cluster node
 *          itself, not a separate leaf. A folder with no hub is still a
 *          cluster, titled by its folder name, with path null.
 * page     any other markdown file (id "page:<path>"), a leaf under its folder.
 * unfiled  pages at the scope root other than index.md and log.md (id
 *          "unfiled"). Only exists when it has children.
 *
 * log.md at the scope root is a page under root. Folders with no markdown
 * files anywhere beneath them are left out.
 */
export type NodeKind = "root" | "cluster" | "page" | "unfiled";

export interface TreeNode {
  id: string;
  kind: NodeKind;
  /** The file this node opens: the page, the hub, index.md, or null. */
  path: string | null;
  /** Folder path for root ("") and clusters, null otherwise. */
  folder: string | null;
  title: string;
  type: string | null;
  tags: string[];
  parent: string | null;
  /** Child ids, clusters first, then pages, each sorted by title. */
  children: string[];
  /** root 0, top-level clusters 1, and so on. */
  depth: number;
  /** Pages beneath this node, counting hubs; 1 for a page. Sizes circles. */
  weight: number;
}

export interface Tree {
  rootId: "root";
  nodes: Map<string, TreeNode>;
  /** File path (pages, hubs, index.md) to the node id that represents it. */
  byPath: Map<string, string>;
}

// ---------------------------------------------------------------- graph

/** Links between node ids. Self-links are dropped. */
export interface Edge {
  source: string;
  target: string;
  count: number;
}

/**
 * What is on screen for a given set of open clusters. A node is visible when
 * every ancestor is in `open`; ids in `open` with a closed ancestor are
 * ignored. "root" must be in `open` for anything below the index to show.
 *
 * A closed cluster is drawn as one node. An open cluster shows its children
 * inside a ring; if it has a hub (root: index.md) it also stays in `nodes`,
 * drawn as the hub page at the ring's centre, so links to the hub stay
 * visible. An open cluster without a hub (and open "unfiled") is a ring only.
 *
 * Each page-level edge is lifted to the visible representative of each end
 * (the node itself if visible, else its highest closed ancestor) and summed.
 * An edge whose ends lift to the same node is dropped.
 */
export interface VisibleGraph {
  /** Visible node ids, parents before children. */
  nodes: string[];
  /** Open cluster ids whose containing ring is drawn (open and visible). */
  rings: string[];
  edges: Edge[];
}

export interface RankedLink {
  id: string;
  title: string;
  /** links_in + links_out + 2 when the link runs both ways. */
  score: number;
  /** Links from the neighbour to this node. */
  linksIn: number;
  /** Links from this node to the neighbour. */
  linksOut: number;
  /** The neighbour's total inbound links, used to break ties. */
  inbound: number;
}

export interface ClusterInfo {
  /** Pages inside with the most links arriving from outside the cluster. */
  entryPoints: RankedLink[];
  /** Other top-level-or-sibling clusters by total link weight, both ways. */
  neighbours: { id: string; title: string; weight: number }[];
}

export interface ModelOptions {
  /**
   * Regular expressions matched against a page's basename without .md. Matching
   * pages are left out of rankings (never out of the tree or the edges).
   */
  exclude: string[];
}

export const DEFAULT_EXCLUDE = [
  "-(pretest-bank|posttest-bank|mastery|dashboard|guide|final-review)$",
  "^(index|log)$",
];

export interface GraphModel {
  tree: Tree;
  /** Page-level edges between node ids (hub links land on their cluster). */
  edges: Edge[];
  visible(open: ReadonlySet<string>): VisibleGraph;
  /** Top neighbours of a page or cluster's hub, excluded pages left out. */
  rankLinks(id: string, limit?: number): RankedLink[];
  clusterInfo(id: string, limit?: number): ClusterInfo;
  inbound(id: string): number;
  outbound(id: string): number;
}

// ---------------------------------------------------------------- summaries

/** One entry of the sidecar (map-summaries.json), keyed by page path. */
export interface Summary {
  summary: string;
  /** First 16 hex chars of sha256 over the page body (frontmatter stripped). */
  hash: string;
  /** YYYY-MM-DD the summary was written. */
  updated: string;
}

export type SummaryMap = Record<string, Summary>;

// ---------------------------------------------------------------- layout

/** World-space circle for a node. Pages have small r; clusters contain children. */
export interface Placement {
  x: number;
  y: number;
  r: number;
}

/**
 * Positions for every node at every depth, computed once with a fixed seed so
 * the map looks the same on every open. A child's circle lies inside its
 * parent's circle.
 */
export type Layout = Map<string, Placement>;

// ---------------------------------------------------------------- theme

/** Colours read from Obsidian's CSS variables (or the harness's defaults). */
export interface Theme {
  background: string;
  node: string;
  nodeFocused: string;
  nodeTag: string;
  unfiled: string;
  line: string;
  lineHighlight: string;
  text: string;
  ring: string;
  font: string;
}

// ---------------------------------------------------------------- renderer

export interface ZoomOptions {
  /** A cluster opens when its circle exceeds this many CSS pixels in radius. */
  openPx: number;
  /** An open cluster closes when its circle falls below this. */
  closePx: number;
}

export interface RendererEvents {
  /** Pointer entered a node (id) or left all nodes (null). Screen coords in CSS px, relative to the canvas. */
  hover: (id: string | null, at: { x: number; y: number }) => void;
  click: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  dblclick: (id: string) => void;
  /** The focus path changed: root first, deepest open cluster at the centre last. */
  focus: (path: string[]) => void;
}

export interface Renderer {
  mount(container: HTMLElement): void;
  setGraph(model: GraphModel, layout: Layout): void;
  setTheme(theme: Theme): void;
  setZoom(options: ZoomOptions): void;
  /** Animate to fit a node, opening its ancestors (and itself if a cluster). */
  flyTo(id: string): void;
  /** Fly back to the first frame: the whole top level fitted, every cluster closed. */
  reset(): void;
  /** Dim everything except this node and its visible neighbours; null clears. */
  highlight(id: string | null): void;
  resize(): void;
  on<K extends keyof RendererEvents>(event: K, cb: RendererEvents[K]): void;
  destroy(): void;
}

// ---------------------------------------------------------------- settings

export interface BrainMapSettings {
  /** Vault-relative folder the map covers. */
  scopeRoot: string;
  /** Vault-relative path of the summaries sidecar. */
  sidecarPath: string;
  openPx: number;
  closePx: number;
  exclude: string[];
}

export const DEFAULT_SETTINGS: BrainMapSettings = {
  scopeRoot: "wiki",
  sidecarPath: "wiki/meta/map-summaries.json",
  openPx: 140,
  closePx: 100,
  exclude: DEFAULT_EXCLUDE,
};
