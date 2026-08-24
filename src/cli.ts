import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startWorktreeConsoleRuntime } from "./server/runtime";

export type CliOptions = {
  packageRoot?: string;
};

export async function main(argv = process.argv.slice(2), options: CliOptions = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  await startWorktreeConsoleRuntime({
    argv,
    packageRoot: options.packageRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..")
  });
}

function printHelp() {
  console.log(`Worktree Console

Usage:
  worktree-console [options]

Options:
  --port <port>        Local port for the single-server console. Defaults to 5273.
  --host <host>        Hostname to bind. Defaults to 127.0.0.1.
  --data-dir <path>    Directory for projects.json and activity-log.json.
  --open               Open the browser after starting.
  --no-open            Start without opening the browser.
  -h, --help           Show this help.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
