// Builds the plugin into dist/ (main.js, manifest.json, styles.css), the folder
// scripts/link-plugin.ps1 junctions into a vault's .obsidian/plugins/brain-map.
//   node esbuild.config.mjs              watch build of the plugin
//   node esbuild.config.mjs production   one minified build
//   node esbuild.config.mjs harness      serve dev/ at http://localhost:8000 (no Obsidian)
import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { builtinModules } from "node:module";

const mode = process.argv[2] ?? "watch";
mkdirSync("dist", { recursive: true });
const copyStatic = {
  name: "copy-static",
  setup(build) {
    build.onEnd(() => {
      copyFileSync("manifest.json", "dist/manifest.json");
      copyFileSync("styles.css", "dist/styles.css");
    });
  },
};

if (mode === "harness") {
  const ctx = await esbuild.context({
    entryPoints: ["dev/harness.ts"],
    bundle: true,
    format: "esm",
    outfile: "dev/harness.js",
    sourcemap: "inline",
    target: "es2020",
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: ".", port: 8000 });
  console.log(`harness: http://localhost:${port}/dev/`);
} else {
  const ctx = await esbuild.context({
    entryPoints: ["main.ts"],
    bundle: true,
    define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    sourcemap: mode === "production" ? false : "inline",
    minify: mode === "production",
    treeShaking: true,
    outfile: "dist/main.js",
    plugins: [copyStatic],
  });
  if (mode === "production") { await ctx.rebuild(); await ctx.dispose(); }
  else await ctx.watch();
}
