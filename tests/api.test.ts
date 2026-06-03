import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/server/app";
import { ActivityLog } from "../src/server/activity";
import { ProjectRegistry } from "../src/server/registry";

let tempDir: string;
const execFileAsync = promisify(execFile);

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "worktree-console-api-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("createApp", () => {
  it("returns API health without building a dashboard snapshot", async () => {
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry: new ProjectRegistry(join(tempDir, "projects.json"))
    });

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({ ok: true });
  });

  it("registers projects and returns dashboard snapshots", async () => {
    const activityLog = new ActivityLog(join(tempDir, "activity.json"));
    const app = createApp({
      activityLog,
      registry: new ProjectRegistry(join(tempDir, "projects.json"))
    });

    const addResponse = await request(app)
      .post("/api/projects")
      .send({ name: "Missing repo", path: join(tempDir, "missing"), tags: ["demo"] })
      .expect(201);

    expect(addResponse.body).toMatchObject({
      name: "Missing repo",
      tags: ["demo"]
    });

    const dashboardResponse = await request(app).get("/api/projects").expect(200);

    expect(dashboardResponse.body.summary).toMatchObject({
      projects: 1,
      worktrees: 0,
      services: 0,
      runningServices: 0,
      dirty: 0,
      missing: 1,
      clean: 0
    });
    expect(dashboardResponse.body.health).toMatchObject({
      counts: expect.objectContaining({
        missingProjects: 1
      }),
      issues: expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-project",
          projectName: "Missing repo"
        })
      ])
    });
    expect(dashboardResponse.body.projects[0]).toMatchObject({
      id: addResponse.body.id,
      name: "Missing repo",
      exists: false,
      isGitRepository: false,
      status: "missing",
      services: []
    });

    const updateResponse = await request(app)
      .patch(`/api/projects/${addResponse.body.id}`)
      .send({ name: "Renamed repo" })
      .expect(200);

    expect(updateResponse.body).toMatchObject({
      id: addResponse.body.id,
      name: "Renamed repo"
    });

    const activityResponse = await request(app).get("/api/activity").expect(200);
    expect(activityResponse.body.events).toEqual([
      expect.objectContaining({
        action: "project.update",
        label: "Updated project",
        projectName: "Renamed repo",
        target: "Renamed repo"
      }),
      expect.objectContaining({
        action: "project.add",
        label: "Added project",
        projectName: "Missing repo",
        target: "Missing repo"
      })
    ]);
  });

  it("registers project services and returns service snapshots", async () => {
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry: new ProjectRegistry(join(tempDir, "projects.json")),
      serviceManager: {
        snapshot: async (_projectId, service) => ({
          ...service,
          status: "stopped",
          startedByConsole: false,
          pid: null,
          portsStatus: service.ports.map((port) => ({
            port,
            listening: false,
            pid: null,
            processName: null
          })),
          logPreview: []
        }),
        start: async () => {
          throw new Error("not used");
        },
        stop: async () => {
          throw new Error("not used");
        },
        restart: async () => {
          throw new Error("not used");
        },
        logs: async () => []
      }
    });

    const projectResponse = await request(app)
      .post("/api/projects")
      .send({ name: "Service repo", path: join(tempDir, "repo") })
      .expect(201);

    const serviceResponse = await request(app)
      .post(`/api/projects/${projectResponse.body.id}/services`)
      .send({
        name: "Admin",
        cwd: join(tempDir, "repo"),
        command: "npm run admin",
        ports: [5274],
        healthUrl: "http://127.0.0.1:5274"
      })
      .expect(201);

    expect(serviceResponse.body).toMatchObject({
      name: "Admin",
      command: "npm run admin",
      ports: [5274]
    });

    const dashboardResponse = await request(app).get("/api/projects").expect(200);
    expect(dashboardResponse.body.summary).toMatchObject({
      services: 1,
      runningServices: 0
    });
    expect(dashboardResponse.body.projects[0].services[0]).toMatchObject({
      id: serviceResponse.body.id,
      name: "Admin",
      status: "stopped"
    });

    await request(app)
      .delete(`/api/projects/${projectResponse.body.id}/services/${serviceResponse.body.id}`)
      .expect(204);
  });

  it("returns a locally selected folder path", async () => {
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry: new ProjectRegistry(join(tempDir, "projects.json")),
      selectFolder: async () => join(tempDir, "chosen")
    });

    const response = await request(app).post("/api/system/select-folder").expect(200);

    expect(response.body).toEqual({
      path: join(tempDir, "chosen")
    });
  });

  it("rejects worktree diff requests with missing query parameters", async () => {
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry: new ProjectRegistry(join(tempDir, "projects.json"))
    });

    const projectResponse = await request(app)
      .post("/api/projects")
      .send({ name: "Repo", path: join(tempDir, "repo") })
      .expect(201);

    await request(app).get(`/api/projects/${projectResponse.body.id}/worktrees/diff`).expect(400);
    await request(app)
      .get(`/api/projects/${projectResponse.body.id}/worktrees/diff`)
      .query({ path: join(tempDir, "repo") })
      .expect(400);
    await request(app)
      .get(`/api/projects/${projectResponse.body.id}/worktrees/diff`)
      .query({ file: "src/App.tsx" })
      .expect(400);
  });

  it("returns 404 when the requested worktree is unknown", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: join(tempDir, "other"), file: "README.md" })
      .expect(404);
  });

  it("returns a bounded changed-file diff and rejects unchanged files", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    await git(repoPath, ["checkout", "-b", "feature/diff"]);
    await git(repoPath, ["commit", "--allow-empty", "-m", "Start feature"]);
    await writeLines(repoPath, "src/App.tsx", 260);
    await git(repoPath, ["add", "src/App.tsx"]);
    await git(repoPath, ["commit", "-m", "Add app"]);
    await writeLines(repoPath, "src/App.tsx", 520);

    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    const response = await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: repoPath, file: "src/App.tsx" })
      .expect(200);

    expect(response.body).toMatchObject({
      worktreePath: expect.any(String),
      filePath: "src/App.tsx",
      truncated: true,
      lineCount: expect.any(Number)
    });
    expect(normalizePath(response.body.worktreePath)).toBe(normalizePath(repoPath));
    expect(response.body.lineCount).toBeGreaterThan(200);
    expect(response.body.diff.split(/\r?\n/)).toHaveLength(200);
    expect(response.body.diff).toContain("diff --git");

    await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: repoPath, file: "README.md" })
      .expect(404);
  });
});

async function createGitRepo(repoPath: string): Promise<void> {
  await git(tempDir, ["init", repoPath]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
  await writeLines(repoPath, "README.md", 2);
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "Initial commit"]);
}

async function writeLines(repoPath: string, filePath: string, count: number): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const directory = join(repoPath, filePath.split("/").slice(0, -1).join("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(repoPath, filePath),
    Array.from({ length: count }, (_value, index) => `line ${index + 1}`).join("\n") + "\n"
  );
}

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    timeout: 12000
  });
}

function normalizePath(path: string): string {
  return realpathSync.native(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
