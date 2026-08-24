import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

import { ActivityLog } from "./activity";
import { createApp } from "./app";
import { ProjectRegistry } from "./registry";

type SupportedPlatform = NodeJS.Platform | "win32" | "darwin" | "linux";

export type RuntimeConfigInput = {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  packageRoot: string;
  platform: SupportedPlatform;
};

export type RuntimeConfig = {
  activityLogPath: string;
  dataDir: string;
  host: string;
  openBrowser: boolean;
  port: number;
  registryPath: string;
  staticDir: string;
  url: string;
};

export type StartRuntimeOptions = Partial<RuntimeConfigInput> & {
  onListening?: (config: RuntimeConfig) => void;
};

export function resolveRuntimeConfig({
  argv,
  cwd,
  env,
  homeDir,
  packageRoot,
  platform
}: RuntimeConfigInput): RuntimeConfig {
  const flags = parseRuntimeFlags(argv);
  const dataDir = normalizePath(
    flags.dataDir ?? env.WORKTREE_CONSOLE_DATA_DIR ?? defaultUserDataDir({ env, homeDir, platform }),
    cwd
  );
  const port = flags.port ?? parsePort(env.PORT) ?? 5273;
  const host = flags.host ?? env.HOST ?? "127.0.0.1";
  const staticDir = normalizePath(flags.staticDir ?? join(packageRoot, "dist"), cwd);
  const registryPath = normalizePath(env.WORKTREE_CONSOLE_REGISTRY ?? join(dataDir, "projects.json"), cwd);
  const activityLogPath = normalizePath(
    env.WORKTREE_CONSOLE_ACTIVITY_LOG ?? join(dataDir, "activity-log.json"),
    cwd
  );

  return {
    activityLogPath,
    dataDir,
    host,
    openBrowser: flags.openBrowser,
    port,
    registryPath,
    staticDir,
    url: `http://${host}:${port}`
  };
}

export function defaultUserDataDir({
  env,
  homeDir,
  platform
}: {
  env: Record<string, string | undefined>;
  homeDir: string;
  platform: SupportedPlatform;
}): string {
  if (platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(homeDir, "AppData", "Local"), "Worktree Console");
  }
  if (platform === "darwin") {
    return joinPosix(homeDir, "Library", "Application Support", "Worktree Console");
  }
  return joinPosix(env.XDG_DATA_HOME ?? joinPosix(homeDir, ".local", "share"), "worktree-console");
}

export async function startWorktreeConsoleRuntime(options: StartRuntimeOptions = {}) {
  const config = resolveRuntimeConfig({
    argv: options.argv ?? process.argv.slice(2),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    homeDir: options.homeDir ?? homedir(),
    packageRoot: options.packageRoot ?? process.cwd(),
    platform: options.platform ?? process.platform
  });

  await mkdir(dirname(config.registryPath), { recursive: true });
  await mkdir(dirname(config.activityLogPath), { recursive: true });

  const app = createApp({
    activityLog: new ActivityLog(config.activityLogPath),
    registry: new ProjectRegistry(config.registryPath),
    staticDir: config.staticDir
  });

  const server = app.listen(config.port, config.host, () => {
    options.onListening?.(config);
    console.log(`Worktree Console listening on ${config.url}`);
    console.log(`Registry: ${config.registryPath}`);
    console.log(`Activity log: ${config.activityLogPath}`);
    if (config.openBrowser) {
      openUrl(config.url);
    }
  });

  return { config, server };
}

function parseRuntimeFlags(argv: string[]) {
  const flags: {
    dataDir?: string;
    host?: string;
    openBrowser: boolean;
    port?: number;
    staticDir?: string;
  } = {
    openBrowser: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-open") {
      flags.openBrowser = false;
    } else if (arg === "--open") {
      flags.openBrowser = true;
    } else if (arg === "--port") {
      flags.port = parsePort(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--port=")) {
      flags.port = parsePort(arg.slice("--port=".length));
    } else if (arg === "--host") {
      flags.host = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--host=")) {
      flags.host = arg.slice("--host=".length);
    } else if (arg === "--data-dir") {
      flags.dataDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--data-dir=")) {
      flags.dataDir = arg.slice("--data-dir=".length);
    } else if (arg === "--static-dir") {
      flags.staticDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--static-dir=")) {
      flags.staticDir = arg.slice("--static-dir=".length);
    }
  }

  return flags;
}

function parsePort(value: string | undefined): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function normalizePath(path: string, cwd: string): string {
  return (isAbsolute(path) ? resolve(path) : resolve(cwd, path)).replace(/\\/g, "/");
}

function joinPosix(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const normalized = part.replace(/\\/g, "/");
      if (index === 0) return normalized.replace(/\/+$/, "");
      return normalized.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
}

function openUrl(url: string) {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }

  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
    detached: true,
    stdio: "ignore"
  }).unref();
}
