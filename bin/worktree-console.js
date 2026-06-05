#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = pathToFileURL(join(packageRoot, "src", "cli.ts")).href;

try {
  const { main } = await tsImport(entry, import.meta.url);
  await main(process.argv.slice(2), { packageRoot });
} catch (error) {
  console.error((error instanceof Error ? error.stack || error.message : String(error)));
  process.exitCode = 1;
}
