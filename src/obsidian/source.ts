import { normalizePath, type App } from "obsidian";
import type { RawGraph, RawPage } from "../contract";

/** Scope prefix with a trailing slash, or "" for the whole vault. */
export function scopePrefix(scopeRoot: string): string {
  const root = normalizePath(scopeRoot || "/").replace(/^\/+|\/+$/g, "");
  return root ? root + "/" : "";
}

const tagList = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [])
    .map((t) => String(t).replace(/^#/, "").trim())
    .filter(Boolean);

/** Read the scope's pages and resolved links from Obsidian's metadata cache. */
export function readGraph(app: App, scopeRoot: string): RawGraph {
  const prefix = scopePrefix(scopeRoot);
  const rel = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : null);

  const pages: RawPage[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const path = rel(f.path);
    if (path === null) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    pages.push({
      path,
      title: typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : f.basename,
      type: typeof fm.type === "string" ? fm.type : null,
      tags: tagList(fm.tags),
    });
  }

  const links: RawGraph["links"] = [];
  for (const [src, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
    const source = rel(src);
    if (source === null || !source.endsWith(".md")) continue;
    for (const [dst, count] of Object.entries(targets)) {
      const target = rel(dst);
      if (target !== null && target.endsWith(".md")) links.push({ source, target, count });
    }
  }
  return { pages, links };
}
