import { build, context } from "esbuild";
import { readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const isProd = process.argv[2] === "production";

const buildOptions = {
  absWorkingDir: here,
  entryPoints: [join(here, "src", "main.ts")],
  outfile: join(here, "main.js"),
  bundle: true,
  format: "cjs",
  target: "ES2020",
  platform: "node",
  logLevel: "info",
  treeShaking: true,
  minify: isProd,
  sourcemap: isProd ? false : "inline",
  banner: { js: "/* obsidian-choir - bundled by esbuild */" },
  external: ["obsidian", "electron"],
};

async function bundleStyles() {
  const styles = await readFile(join(here, "src", "styles.css"), "utf8");
  await writeFile(join(here, "styles.css"), styles);
}

if (isProd) {
  await build(buildOptions);
  await bundleStyles();
} else {
  const ctx = await context(buildOptions);
  await ctx.watch();
  await bundleStyles();
  console.log("[choir] esbuild watching src/main.ts");
}
