import { describe, expect, it } from "vitest";

import { defaultUserDataDir, resolveRuntimeConfig } from "../src/server/runtime";

describe("runtime configuration", () => {
  it("uses a user data directory for packaged runs instead of the current repo data folder", () => {
    const config = resolveRuntimeConfig({
      argv: [],
      cwd: "E:/worktree-console",
      env: { LOCALAPPDATA: "C:/Users/Ada/AppData/Local" },
      homeDir: "C:/Users/Ada",
      packageRoot: "E:/worktree-console",
      platform: "win32"
    });

    expect(config.port).toBe(5273);
    expect(config.host).toBe("127.0.0.1");
    expect(config.openBrowser).toBe(true);
    expect(config.dataDir).toBe("C:/Users/Ada/AppData/Local/Worktree Console");
    expect(config.registryPath).toBe("C:/Users/Ada/AppData/Local/Worktree Console/projects.json");
    expect(config.activityLogPath).toBe("C:/Users/Ada/AppData/Local/Worktree Console/activity-log.json");
    expect(config.staticDir).toBe("E:/worktree-console/dist");
  });

  it("allows CLI flags and environment variables to override packaged defaults", () => {
    const config = resolveRuntimeConfig({
      argv: ["--port", "6600", "--host", "localhost", "--data-dir", "D:/console-data", "--no-open"],
      cwd: "E:/worktree-console",
      env: {
        PORT: "6200",
        WORKTREE_CONSOLE_ACTIVITY_LOG: "D:/activity/custom.json"
      },
      homeDir: "C:/Users/Ada",
      packageRoot: "E:/worktree-console",
      platform: "win32"
    });

    expect(config.port).toBe(6600);
    expect(config.host).toBe("localhost");
    expect(config.openBrowser).toBe(false);
    expect(config.dataDir).toBe("D:/console-data");
    expect(config.registryPath).toBe("D:/console-data/projects.json");
    expect(config.activityLogPath).toBe("D:/activity/custom.json");
  });

  it("resolves relative runtime paths from the launch directory", () => {
    const config = resolveRuntimeConfig({
      argv: ["--data-dir", ".console-data", "--static-dir", "build-output"],
      cwd: "E:/projects/worktree-console",
      env: {},
      homeDir: "C:/Users/Ada",
      packageRoot: "E:/worktree-console",
      platform: "win32"
    });

    expect(config.dataDir).toBe("E:/projects/worktree-console/.console-data");
    expect(config.registryPath).toBe("E:/projects/worktree-console/.console-data/projects.json");
    expect(config.activityLogPath).toBe("E:/projects/worktree-console/.console-data/activity-log.json");
    expect(config.staticDir).toBe("E:/projects/worktree-console/build-output");
  });

  it("derives platform-specific user data directories", () => {
    expect(
      defaultUserDataDir({
        env: {},
        homeDir: "/Users/ada",
        platform: "darwin"
      })
    ).toBe("/Users/ada/Library/Application Support/Worktree Console");

    expect(
      defaultUserDataDir({
        env: { XDG_DATA_HOME: "/home/ada/.local/state" },
        homeDir: "/home/ada",
        platform: "linux"
      })
    ).toBe("/home/ada/.local/state/worktree-console");
  });
});
