import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createApp } from "./app";
import { ProjectRegistry } from "./registry";

const port = Number(process.env.PORT ?? 4217);
const registryPath =
  process.env.WORKTREE_CONSOLE_REGISTRY ??
  join(process.cwd(), "data", "projects.json");

await mkdir(dirname(registryPath), { recursive: true });

const app = createApp({
  registry: new ProjectRegistry(registryPath)
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Worktree Console API listening on http://127.0.0.1:${port}`);
  console.log(`Registry: ${registryPath}`);
});
