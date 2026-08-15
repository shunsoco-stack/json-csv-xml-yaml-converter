import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextOutput = resolve(root, "out");
const sitesOutput = resolve(root, "dist");

await rm(sitesOutput, { recursive: true, force: true });
await mkdir(resolve(sitesOutput, "server"), { recursive: true });
await cp(nextOutput, resolve(sitesOutput, "client"), { recursive: true });

await writeFile(
  resolve(sitesOutput, "server", "index.js"),
  `export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
`,
  "utf8",
);
