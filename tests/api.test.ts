import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import type { RegisteredService, ServiceSnapshot } from "../src/shared/types";

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

  it("serves built frontend assets from the same Express app when a static directory is configured", async () => {
    const staticDir = join(tempDir, "dist");
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, "index.html"), '<!doctype html><div id="root">console</div>', "utf8");
    await writeFile(join(staticDir, "asset.txt"), "asset", "utf8");

    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry: new ProjectRegistry(join(tempDir, "projects.json")),
      staticDir
    });

    const indexResponse = await request(app).get("/").expect(200);
    expect(indexResponse.text).toContain("console");

    const spaResponse = await request(app).get("/projects/demo").expect(200);
    expect(spaResponse.text).toContain("console");

    const assetResponse = await request(app).get("/asset.txt").expect(200);
    expect(assetResponse.text).toBe("asset");

    const healthResponse = await request(app).get("/api/health").expect(200);
    expect(healthResponse.body).toEqual({ ok: true });
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
          processOwnership: "none" as const,
          processOwnerHint: null,
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

  it("creates service groups and returns group snapshots in the dashboard", async () => {
    const activityLog = new ActivityLog(join(tempDir, "activity.json"));
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog,
      registry,
      serviceManager: fakeServiceManager({
        snapshots: {
          API: "running",
          Worker: "starting"
        }
      }).manager
    });

    const projectResponse = await request(app)
      .post("/api/projects")
      .send({ name: "Grouped repo", path: join(tempDir, "repo") })
      .expect(201);
    const apiResponse = await request(app)
      .post(`/api/projects/${projectResponse.body.id}/services`)
      .send({
        name: "API",
        cwd: join(tempDir, "repo"),
        command: "npm run api",
        ports: [5200],
        healthUrl: null
      })
      .expect(201);
    const workerResponse = await request(app)
      .post(`/api/projects/${projectResponse.body.id}/services`)
      .send({
        name: "Worker",
        cwd: join(tempDir, "repo"),
        command: "npm run worker",
        ports: [5201],
        healthUrl: null
      })
      .expect(201);

    const groupResponse = await request(app)
      .post(`/api/projects/${projectResponse.body.id}/service-groups`)
      .send({ name: " Core ", serviceIds: [apiResponse.body.id, workerResponse.body.id] })
      .expect(201);

    expect(groupResponse.body).toMatchObject({
      name: "Core",
      serviceIds: [apiResponse.body.id, workerResponse.body.id]
    });

    const dashboardResponse = await request(app).get("/api/projects").expect(200);
    expect(dashboardResponse.body.projects[0].serviceGroups).toEqual([
      expect.objectContaining({
        id: groupResponse.body.id,
        name: "Core",
        status: "running",
        serviceIds: [apiResponse.body.id, workerResponse.body.id],
        services: [
          expect.objectContaining({ id: apiResponse.body.id, status: "running" }),
          expect.objectContaining({ id: workerResponse.body.id, status: "starting" })
        ]
      })
    ]);

    const activityResponse = await request(app).get("/api/activity").expect(200);
    expect(activityResponse.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "service-group.add",
          label: "Registered service group",
          target: "Core"
        })
      ])
    );
  });

  it("deletes service groups", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry,
      serviceManager: fakeServiceManager().manager
    });
    const { project, services } = await registerProjectServices(registry);
    const group = await registry.addServiceGroup(project.id, {
      name: "Core",
      serviceIds: services.map((service) => service.id)
    });

    await request(app).delete(`/api/projects/${project.id}/service-groups/${group.id}`).expect(204);

    const dashboardResponse = await request(app).get("/api/projects").expect(200);
    expect(dashboardResponse.body.projects[0].serviceGroups).toEqual([]);

    const activityResponse = await request(app).get("/api/activity").expect(200);
    expect(activityResponse.body.events[0]).toMatchObject({
      action: "service-group.remove",
      label: "Removed service group",
      target: "Core"
    });
  });

  it("starts service groups in configured order and returns per-service results", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const calls: string[] = [];
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry,
      serviceManager: fakeServiceManager({ calls }).manager
    });
    const { project, services } = await registerProjectServices(registry);
    const group = await registry.addServiceGroup(project.id, {
      name: "Core",
      serviceIds: services.map((service) => service.id)
    });

    const response = await request(app)
      .post(`/api/projects/${project.id}/service-groups/${group.id}/start`)
      .expect(202);

    expect(calls).toEqual(["start:API", "start:Worker"]);
    expect(response.body).toMatchObject({
      groupId: group.id,
      groupName: "Core",
      action: "start",
      errors: [],
      results: [
        {
          serviceId: services[0].id,
          serviceName: "API",
          operation: "start",
          ok: true,
          snapshot: expect.objectContaining({ status: "running" })
        },
        {
          serviceId: services[1].id,
          serviceName: "Worker",
          operation: "start",
          ok: true,
          snapshot: expect.objectContaining({ status: "running" })
        }
      ]
    });

    const activityResponse = await request(app).get("/api/activity").expect(200);
    expect(activityResponse.body.events[0]).toMatchObject({
      action: "service-group.start",
      label: "Started service group",
      target: "Core",
      status: "success"
    });
  });

  it("stops service groups in reverse order", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const calls: string[] = [];
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry,
      serviceManager: fakeServiceManager({ calls }).manager
    });
    const { project, services } = await registerProjectServices(registry);
    const group = await registry.addServiceGroup(project.id, {
      name: "Core",
      serviceIds: services.map((service) => service.id)
    });

    await request(app).post(`/api/projects/${project.id}/service-groups/${group.id}/stop`).expect(202);

    expect(calls).toEqual(["stop:Worker", "stop:API"]);
  });

  it("restarts service groups by stopping reverse order then starting configured order", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const calls: string[] = [];
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry,
      serviceManager: fakeServiceManager({ calls }).manager
    });
    const { project, services } = await registerProjectServices(registry);
    const group = await registry.addServiceGroup(project.id, {
      name: "Core",
      serviceIds: services.map((service) => service.id)
    });

    const response = await request(app)
      .post(`/api/projects/${project.id}/service-groups/${group.id}/restart`)
      .expect(202);

    expect(calls).toEqual(["stop:Worker", "stop:API", "start:API", "start:Worker"]);
    expect(
      response.body.results.map((result: { operation: string; serviceName: string }) => `${result.operation}:${result.serviceName}`)
    ).toEqual(["stop:Worker", "stop:API", "start:API", "start:Worker"]);
  });

  it("keeps processing service group actions when one service fails", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const calls: string[] = [];
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry,
      serviceManager: fakeServiceManager({ calls, failStartFor: ["API"] }).manager
    });
    const { project, services } = await registerProjectServices(registry);
    const group = await registry.addServiceGroup(project.id, {
      name: "Core",
      serviceIds: services.map((service) => service.id)
    });

    const response = await request(app)
      .post(`/api/projects/${project.id}/service-groups/${group.id}/start`)
      .expect(202);

    expect(calls).toEqual(["start:API", "start:Worker"]);
    expect(response.body.results).toEqual([
      expect.objectContaining({
        serviceId: services[0].id,
        serviceName: "API",
        operation: "start",
        ok: false,
        error: "start failed for API"
      }),
      expect.objectContaining({
        serviceId: services[1].id,
        serviceName: "Worker",
        operation: "start",
        ok: true,
        snapshot: expect.objectContaining({ status: "running" })
      })
    ]);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        serviceId: services[0].id,
        serviceName: "API",
        operation: "start",
        error: "start failed for API"
      })
    ]);

    const activityResponse = await request(app).get("/api/activity").expect(200);
    expect(activityResponse.body.events[0]).toMatchObject({
      action: "service-group.start",
      status: "failed",
      detail: "1 failed, 1 succeeded"
    });
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

  it("returns 404 when the worktree diff project is unknown", async () => {
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry: new ProjectRegistry(join(tempDir, "projects.json"))
    });

    const response = await request(app)
      .get("/api/projects/missing-project/worktrees/diff")
      .query({ path: join(tempDir, "repo"), file: "README.md" })
      .expect(404);

    expect(response.body).toEqual({ error: "Project not found." });
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

  it("returns git operation status for a registered worktree", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    await writeFileText(repoPath, "README.md", "changed\n");
    await git(repoPath, ["add", "README.md"]);
    await writeFileText(repoPath, "src/App.tsx", "unstaged\n");

    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    const response = await request(app)
      .get(`/api/projects/${project.id}/git/status`)
      .query({ path: repoPath })
      .expect(200);

    expect(response.body).toMatchObject({
      projectId: project.id,
      worktreePath: expect.any(String),
      changes: {
        staged: [expect.objectContaining({ path: "README.md" })],
        unstaged: [expect.objectContaining({ path: "src/App.tsx" })]
      }
    });
    expect(normalizePath(response.body.worktreePath)).toBe(normalizePath(repoPath));
  });

  it("rejects staging files not reported by git status", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    await request(app)
      .post(`/api/projects/${project.id}/git/stage`)
      .send({ path: repoPath, files: ["not-reported.txt"] })
      .expect(409);
  });

  it("rejects malformed git stage payloads as bad requests", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    await request(app).post(`/api/projects/${project.id}/git/stage`).send({ path: repoPath }).expect(400);
  });

  it("records failed git operations in activity", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    await writeFileText(repoPath, "README.md", "dirty\n");
    const activityLog = new ActivityLog(join(tempDir, "activity.json"));
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({ activityLog, registry });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    await request(app).post(`/api/projects/${project.id}/git/pull`).send({ path: repoPath }).expect(409);

    const activity = await request(app).get("/api/activity").expect(200);
    expect(activity.body.events[0]).toMatchObject({
      action: "git.pull",
      status: "failed",
      targetType: "git"
    });
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

  it("returns a non-empty diff for staged-only changed files", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    await writeLines(repoPath, "README.md", 4);
    await git(repoPath, ["add", "README.md"]);

    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    const response = await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: repoPath, file: "README.md" })
      .expect(200);

    expect(response.body.diff).toContain("diff --git");
    expect(response.body.diff).toContain("+line 4");
    expect(response.body.diff).not.toEqual("");
    expect(response.body.truncated).toBe(false);
  });

  it("returns both staged and unstaged diff content for mixed changed files", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    await writeFileText(repoPath, "README.md", "base\n");
    await git(repoPath, ["add", "README.md"]);
    await git(repoPath, ["commit", "-m", "Set base readme"]);
    await writeFileText(repoPath, "README.md", "staged\n");
    await git(repoPath, ["add", "README.md"]);
    await writeFileText(repoPath, "README.md", "unstaged\n");

    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    const response = await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: repoPath, file: "README.md" })
      .expect(200);

    expect(response.body.diff).toContain("+staged");
    expect(response.body.diff).toContain("+unstaged");
  });

  it("returns a synthetic added-file diff for untracked files", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    await writeLines(repoPath, "src/NewFile.ts", 3);

    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    const response = await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: repoPath, file: "src/NewFile.ts" })
      .expect(200);

    expect(response.body.diff).toContain("diff --git a/src/NewFile.ts b/src/NewFile.ts");
    expect(response.body.diff).toContain("new file mode 100644");
    expect(response.body.diff).toContain("--- /dev/null");
    expect(response.body.diff).toContain("+++ b/src/NewFile.ts");
    expect(response.body.diff).toContain("+line 1");
    expect(response.body.diff).toContain("+line 3");
    expect(response.body.truncated).toBe(false);
  });

  it("returns a non-empty diff for changed files with non-ASCII paths", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    await writeLines(repoPath, "src/café.txt", 2);
    await git(repoPath, ["add", "src/café.txt"]);
    await git(repoPath, ["commit", "-m", "Add cafe file"]);
    await writeLines(repoPath, "src/café.txt", 4);

    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    const response = await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: repoPath, file: "src/café.txt" })
      .expect(200);

    expect(response.body.filePath).toBe("src/café.txt");
    expect(response.body.diff).toContain("diff --git");
    expect(response.body.diff).toContain("+line 4");
  });

  it("returns a diff for changed files with leading and trailing spaces in the path", async () => {
    const repoPath = join(tempDir, "repo");
    await createGitRepo(repoPath);
    const spacedPath = " spaced file.txt";
    await writeLines(repoPath, spacedPath, 2);
    await git(repoPath, ["add", spacedPath]);
    await git(repoPath, ["commit", "-m", "Add spaced file"]);
    await writeLines(repoPath, spacedPath, 4);

    const registry = new ProjectRegistry(join(tempDir, "projects.json"));
    const app = createApp({
      activityLog: new ActivityLog(join(tempDir, "activity.json")),
      registry
    });
    const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

    const response = await request(app)
      .get(`/api/projects/${project.id}/worktrees/diff`)
      .query({ path: repoPath, file: spacedPath })
      .expect(200);

    expect(response.body.filePath).toBe(spacedPath);
    expect(response.body.diff).toContain("+line 4");
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
  await writeFileText(
    repoPath,
    filePath,
    Array.from({ length: count }, (_value, index) => `line ${index + 1}`).join("\n") + "\n"
  );
}

async function writeFileText(repoPath: string, filePath: string, content: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const directory = join(repoPath, filePath.split("/").slice(0, -1).join("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(repoPath, filePath), content);
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

async function registerProjectServices(registry: ProjectRegistry) {
  const project = await registry.addProject({
    name: "Grouped repo",
    path: join(tempDir, "repo")
  });
  const api = await registry.addService(project.id, {
    name: "API",
    cwd: join(tempDir, "repo"),
    command: "npm run api",
    ports: [5200],
    healthUrl: null
  });
  const worker = await registry.addService(project.id, {
    name: "Worker",
    cwd: join(tempDir, "repo"),
    command: "npm run worker",
    ports: [5201],
    healthUrl: null
  });

  return { project, services: [api, worker] };
}

type FakeServiceManagerOptions = {
  calls?: string[];
  failStartFor?: string[];
  snapshots?: Record<string, ServiceSnapshot["status"]>;
};

function fakeServiceManager(options: FakeServiceManagerOptions = {}) {
  const calls = options.calls ?? [];
  const failStartFor = new Set(options.failStartFor ?? []);
  const snapshots = options.snapshots ?? {};

  return {
    manager: {
      snapshot: async (_projectId: string, service: RegisteredService) =>
        serviceSnapshot(service, snapshots[service.name] ?? "stopped"),
      start: async (_projectId: string, service: RegisteredService) => {
        calls.push(`start:${service.name}`);
        if (failStartFor.has(service.name)) {
          throw new Error(`start failed for ${service.name}`);
        }
        return serviceSnapshot(service, "running");
      },
      stop: async (_projectId: string, service: RegisteredService) => {
        calls.push(`stop:${service.name}`);
        return serviceSnapshot(service, "stopped");
      },
      restart: async (_projectId: string, service: RegisteredService) => {
        calls.push(`restart:${service.name}`);
        return serviceSnapshot(service, "running");
      },
      logs: async () => []
    },
    calls
  };
}

function serviceSnapshot(service: RegisteredService, status: ServiceSnapshot["status"]): ServiceSnapshot {
  return {
    ...service,
    status,
    startedByConsole: status === "running" || status === "starting",
    pid: status === "running" || status === "starting" ? 1234 : null,
    processOwnership: status === "running" || status === "starting" ? "console" : "none",
    processOwnerHint: status === "running" || status === "starting" ? "Started by this console." : null,
    portsStatus: service.ports.map((port) => ({
      port,
      listening: status === "running" || status === "starting",
      pid: status === "running" || status === "starting" ? 1234 : null,
      processName: status === "running" || status === "starting" ? "node.exe" : null
    })),
    logPreview: []
  };
}
