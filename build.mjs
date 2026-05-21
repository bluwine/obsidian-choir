import { build, context } from "esbuild";
import { watch } from "fs";
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

  const styleWatcher = watch(join(here, "src", "styles.css"), async () => {
    try {
      await bundleStyles();
      console.log("[choir] copied src/styles.css");
    } catch (error) {
      console.error("[choir] could not copy src/styles.css", error);
    }
  });

  const dispose = async () => {
    styleWatcher.close();
    await ctx.dispose();
  };

  process.once("SIGINT", () => {
    void dispose().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void dispose().finally(() => process.exit(0));
  });

  console.log("[choir] esbuild watching src/main.ts and src/styles.css");
}
