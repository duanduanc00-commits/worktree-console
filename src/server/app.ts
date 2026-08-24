import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { basename, join } from "node:path";

import express from "express";

import {
  isGitRepository,
  pathExists,
  commitStagedFiles,
  createStash,
  deleteBranch,
  discardFiles,
  fetchRepository,
  pullRepository,
  pushRepository,
  readBranches,
  readBranchStatus,
  readBranchTracking,
  readChangesLatestMtime,
  readContainingBranches,
  readLastCommitTimestamp,
  readMergedBranches,
  readRecentCommits,
  readShortHead,
  readWorktreeFileDiff,
  readWorktreeChanges,
  readWorktrees,
  removeWorktree,
  stageFiles,
  unstageFiles
} from "./git";
import {
  GitOperationError,
  assertCanCommit,
  assertCanPull,
  assertCanPush,
  assertCanStash,
  buildGitOperationStatus,
  parseGitFilesPayload,
  resolveGitTargetPath
} from "./gitOperations";
import { ActivityLog, type ActivityInput } from "./activity";
import { ProjectRegistry } from "./registry";
import { assessWorktreeRemoval, buildBranchInfo } from "./safety";
import { ServiceManager } from "./services";
import { selectFolder as selectLocalFolder } from "./folderPicker";
import { buildHealthSummary } from "./health";
import { mapWithConcurrency } from "./concurrency";
import { sortBranchesByRecentActivity, sortWorktreesByRecentActivity } from "./ordering";
import type {
  ActivityEvent,
  DashboardResponse,
  DetectedWorktreeService,
  GitOperationResponse,
  GitOperationStatus,
  ProjectSnapshot,
  RegisteredProject,
  RegisteredService,
  RegisteredServiceGroup,
  ServiceGroupAction,
  ServiceGroupActionOperation,
  ServiceGroupActionResponse,
  ServiceGroupActionResult,
  ServiceGroupSnapshot,
  ServiceGroupStatus,
  ServiceSnapshot,
  WorktreeDiffResponse
} from "../shared/types";

export type AppDependencies = {
  registry: ProjectRegistry;
  activityLog?: ActivityRecorder;
  serviceManager?: ServiceController;
  selectFolder?: () => Promise<string | null>;
  staticDir?: string;
};

type ActivityRecorder = {
  list(limit?: number): Promise<ActivityEvent[]>;
  record(input: ActivityInput): Promise<ActivityEvent>;
};

type ServiceController = {
  snapshot(
    projectId: string,
    service: RegisteredService,
    projectPath?: string,
    worktreePaths?: string[]
  ): Promise<ServiceSnapshot>;
  start(projectId: string, service: RegisteredService, projectPath?: string, worktreePaths?: string[]): Promise<ServiceSnapshot>;
  stop(projectId: string, service: RegisteredService, projectPath?: string, worktreePaths?: string[]): Promise<ServiceSnapshot>;
  restart(projectId: string, service: RegisteredService, projectPath?: string, worktreePaths?: string[]): Promise<ServiceSnapshot>;
  discoverWorktreeServices?(
    worktrees: Array<{ path: string; branch: string | null }>,
    registeredServices: ServiceSnapshot[]
  ): Promise<DetectedWorktreeService[]>;
  logs(projectId: string, serviceId: string): Promise<string[]>;
};

type GitMutationAction = "fetch" | "pull" | "push" | "stage" | "unstage" | "discard" | "commit" | "stash";

type GitMutationOptions = {
  activityLog: ActivityRecorder;
  registry: ProjectRegistry;
  serviceManager: ServiceController;
  projectId: string;
  body: unknown;
  action: GitMutationAction;
  label: string;
  execute: (status: GitOperationStatus, body: unknown) => Promise<string>;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const DEFAULT_DASHBOARD_CACHE_TTL_MS = 8_000;
const DASHBOARD_SNAPSHOT_CONCURRENCY = 4;

export function createApp({
  activityLog = new ActivityLog(join(process.cwd(), "data", "activity-log.json")),
  registry,
  serviceManager = new ServiceManager(),
  selectFolder = selectLocalFolder,
  staticDir
}: AppDependencies) {
  const app = express();
  let dashboardCache: { expiresAt: number; payload: DashboardResponse } | null = null;
  let dashboardCacheRequest: Promise<DashboardResponse> | null = null;
  app.use(express.json());

  async function buildDashboard() {
    const projects = await registry.listProjects();
    const snapshots = await mapWithConcurrency(projects, DASHBOARD_SNAPSHOT_CONCURRENCY, (project) =>
      snapshotProject(project, serviceManager, { discoverWorktreeServices: true })
    );
    const payload = buildDashboardResponse(snapshots);
    dashboardCache = {
      expiresAt: Date.now() + dashboardCacheTtlMs(),
      payload
    };
    return payload;
  }

  async function readDashboard(allowCache: boolean) {
    const now = Date.now();
    if (allowCache && dashboardCache && dashboardCache.expiresAt > now) {
      return dashboardCache.payload;
    }
    if (allowCache && dashboardCacheRequest) {
      return dashboardCacheRequest;
    }

    const request = buildDashboard().finally(() => {
      if (dashboardCacheRequest === request) {
        dashboardCacheRequest = null;
      }
    });

    if (allowCache) {
      dashboardCacheRequest = request;
    }

    return request;
  }

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/activity", async (request, response, next) => {
    try {
      response.json({ events: await activityLog.list(Number(request.query.limit ?? 100)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/select-folder", async (_request, response, next) => {
    try {
      response.json({ path: await selectFolder() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects", async (request, response, next) => {
    try {
      response.json(await readDashboard(request.query.cache === "1"));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects", async (request, response, next) => {
    try {
      const path = String(request.body?.path ?? "").trim();
      const name = String(request.body?.name ?? basename(path)).trim();
      const tags = Array.isArray(request.body?.tags)
        ? request.body.tags.map(String).filter(Boolean)
        : [];

      if (!path) {
        response.status(400).json({ error: "Project path is required." });
        return;
      }

      const project = await registry.addProject({ name: name || basename(path), path, tags });
      await recordActivity(activityLog, {
        action: "project.add",
        label: "Added project",
        ...projectActivity(project),
        targetType: "project",
        target: project.name,
        detail: project.path
      });
      response.status(201).json(project);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/projects/:id", async (request, response, next) => {
    try {
      const before = await findProject(registry, request.params.id);
      const updated = await registry.updateProject(request.params.id, request.body);
      await recordActivity(activityLog, {
        action: "project.update",
        label: "Updated project",
        ...projectActivity(updated),
        targetType: "project",
        target: updated.name,
        detail: before.name === updated.name ? updated.path : `Renamed from ${before.name} to ${updated.name}`
      });
      response.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:id", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      await registry.removeProject(request.params.id);
      await recordActivity(activityLog, {
        action: "project.remove",
        label: "Removed project",
        ...projectActivity(project),
        targetType: "project",
        target: project.name,
        detail: project.path
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/open-folder", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      openPath(project.path);
      response.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/open-terminal", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      openTerminal(project.path);
      response.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/commits", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      const limit = Number(request.query.limit ?? 5);
      const range = String(request.query.range ?? "all");
      if (!["24h", "7d", "30d", "all"].includes(range)) {
        response.status(400).json({ error: "Unsupported commit range." });
        return;
      }
      const snapshot = await snapshotProject(project, serviceManager);
      const targetPath = resolveGitTargetPath(project, snapshot, request.query.path as string | undefined);
      response.json(
        await readRecentCommits(targetPath, {
          limit,
          range: range as "24h" | "7d" | "30d" | "all"
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/services", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      const name = String(request.body?.name ?? "").trim();
      const cwd = String(request.body?.cwd ?? project.path).trim();
      const command = String(request.body?.command ?? "").trim();
      const ports = parsePorts(request.body?.ports);
      const healthUrl = String(request.body?.healthUrl ?? "").trim() || null;

      if (!name || !cwd || !command) {
        response.status(400).json({ error: "Service name, cwd, and command are required." });
        return;
      }

      const service = await registry.addService(project.id, { name, cwd, command, ports, healthUrl });
      await recordActivity(activityLog, {
        action: "service.add",
        label: "Registered service",
        ...projectActivity(project),
        targetType: "service",
        target: service.name,
        detail: service.command
      });
      response.status(201).json(service);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:id/services/:serviceId", async (request, response, next) => {
    try {
      const { project, service } = await findProjectService(registry, request.params.id, request.params.serviceId);
      await registry.removeService(project.id, request.params.serviceId);
      await recordActivity(activityLog, {
        action: "service.remove",
        label: "Removed service",
        ...projectActivity(project),
        targetType: "service",
        target: service.name,
        detail: service.command
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/service-groups", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      const name = String(request.body?.name ?? "").trim();
      const serviceIds = parseServiceIds(request.body?.serviceIds);

      if (!name || serviceIds === null || serviceIds.length === 0) {
        response.status(400).json({ error: "Service group name and at least one service id are required." });
        return;
      }

      const group = await registry.addServiceGroup(project.id, { name, serviceIds });
      await recordActivity(activityLog, {
        action: "service-group.add",
        label: "Registered service group",
        ...projectActivity(project),
        targetType: "service-group",
        target: group.name,
        detail: describeServiceCount(group.serviceIds.length)
      });
      response.status(201).json(group);
    } catch (error) {
      next(mapRegistryError(error));
    }
  });

  app.patch("/api/projects/:id/service-groups/:groupId", async (request, response, next) => {
    try {
      const { project, group } = await findProjectServiceGroup(registry, request.params.id, request.params.groupId);
      const payload: { name?: string; serviceIds?: string[] } = {};

      if (Object.hasOwn(request.body ?? {}, "name")) {
        payload.name = String(request.body.name ?? "");
      }
      if (Object.hasOwn(request.body ?? {}, "serviceIds")) {
        const serviceIds = parseServiceIds(request.body.serviceIds);
        if (serviceIds === null) {
          response.status(400).json({ error: "Service group serviceIds must be an array." });
          return;
        }
        payload.serviceIds = serviceIds;
      }
      if (payload.name === undefined && payload.serviceIds === undefined) {
        response.status(400).json({ error: "Service group update requires a name or serviceIds." });
        return;
      }

      const updated = await registry.updateServiceGroup(project.id, group.id, payload);
      await recordActivity(activityLog, {
        action: "service-group.update",
        label: "Updated service group",
        ...projectActivity(project),
        targetType: "service-group",
        target: updated.name,
        detail: group.name === updated.name ? describeServiceCount(updated.serviceIds.length) : `Renamed from ${group.name}`
      });
      response.json(updated);
    } catch (error) {
      next(mapRegistryError(error));
    }
  });

  app.delete("/api/projects/:id/service-groups/:groupId", async (request, response, next) => {
    try {
      const { project, group } = await findProjectServiceGroup(registry, request.params.id, request.params.groupId);
      await registry.removeServiceGroup(project.id, group.id);
      await recordActivity(activityLog, {
        action: "service-group.remove",
        label: "Removed service group",
        ...projectActivity(project),
        targetType: "service-group",
        target: group.name,
        detail: describeServiceCount(group.serviceIds.length)
      });
      response.status(204).end();
    } catch (error) {
      next(mapRegistryError(error));
    }
  });

  app.post("/api/projects/:id/service-groups/:groupId/start", async (request, response, next) => {
    try {
      const { project, group, services } = await findProjectServiceGroupServices(
        registry,
        request.params.id,
        request.params.groupId
      );
      const payload = await runServiceGroupAction(serviceManager, project.id, project.path, group, services, "start");
      await recordServiceGroupActionActivity(activityLog, project, group, payload);
      response.status(202).json(payload);
    } catch (error) {
      next(mapRegistryError(error));
    }
  });

  app.post("/api/projects/:id/service-groups/:groupId/stop", async (request, response, next) => {
    try {
      const { project, group, services } = await findProjectServiceGroupServices(
        registry,
        request.params.id,
        request.params.groupId
      );
      const payload = await runServiceGroupAction(serviceManager, project.id, project.path, group, services, "stop");
      await recordServiceGroupActionActivity(activityLog, project, group, payload);
      response.status(202).json(payload);
    } catch (error) {
      next(mapRegistryError(error));
    }
  });

  app.post("/api/projects/:id/service-groups/:groupId/restart", async (request, response, next) => {
    try {
      const { project, group, services } = await findProjectServiceGroupServices(
        registry,
        request.params.id,
        request.params.groupId
      );
      const payload = await runServiceGroupAction(serviceManager, project.id, project.path, group, services, "restart");
      await recordServiceGroupActionActivity(activityLog, project, group, payload);
      response.status(202).json(payload);
    } catch (error) {
      next(mapRegistryError(error));
    }
  });

  app.post("/api/projects/:id/services/:serviceId/start", async (request, response, next) => {
    try {
      const { project, service } = await findProjectService(registry, request.params.id, request.params.serviceId);
      const snapshot = await serviceManager.start(project.id, service);
      await recordActivity(activityLog, {
        action: "service.start",
        label: "Started service",
        ...projectActivity(project),
        targetType: "service",
        target: service.name,
        detail: service.command
      });
      response.status(202).json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/services/:serviceId/stop", async (request, response, next) => {
    try {
      const { project, service } = await findProjectService(registry, request.params.id, request.params.serviceId);
      const worktreePaths = await readServiceWorktreePaths(project.path);
      const snapshot = await serviceManager.stop(project.id, service, project.path, worktreePaths);
      await recordActivity(activityLog, {
        action: "service.stop",
        label: "Stopped service",
        ...projectActivity(project),
        targetType: "service",
        target: service.name,
        detail: service.command
      });
      response.status(202).json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/services/:serviceId/restart", async (request, response, next) => {
    try {
      const { project, service } = await findProjectService(registry, request.params.id, request.params.serviceId);
      const worktreePaths = await readServiceWorktreePaths(project.path);
      const snapshot = await serviceManager.restart(project.id, service, project.path, worktreePaths);
      await recordActivity(activityLog, {
        action: "service.restart",
        label: "Restarted service",
        ...projectActivity(project),
        targetType: "service",
        target: service.name,
        detail: service.command
      });
      response.status(202).json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/services/:serviceId/logs", async (request, response, next) => {
    try {
      await findProjectService(registry, request.params.id, request.params.serviceId);
      response.json({ lines: await serviceManager.logs(request.params.id, request.params.serviceId) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/git/status", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      const snapshot = await snapshotProject(project, serviceManager);
      response.json(await buildGitOperationStatus(project, snapshot, queryPath(request.query.path)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/fetch", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "fetch",
          label: "Fetched branch",
          execute: async (status) => {
            await fetchRepository(status.worktreePath);
            return `Fetched ${status.branch}`;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/pull", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "pull",
          label: "Pulled branch",
          execute: async (status) => {
            assertCanPull(status);
            await pullRepository(status.worktreePath);
            return `Pulled ${status.branch}`;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/push", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "push",
          label: "Pushed branch",
          execute: async (status) => {
            assertCanPush(status);
            await pushRepository(status.worktreePath);
            return `Pushed ${status.branch}`;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/stage", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "stage",
          label: "Staged files",
          execute: async (status, body) => {
            const files = parseGitFilesPayload(body, status.changes.unstaged, "Stage");
            await stageFiles(status.worktreePath, files);
            return `Staged ${describeFileCount(files.length)}`;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/unstage", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "unstage",
          label: "Unstaged files",
          execute: async (status, body) => {
            const files = parseGitFilesPayload(body, status.changes.staged, "Unstage");
            await unstageFiles(status.worktreePath, files);
            return `Unstaged ${describeFileCount(files.length)}`;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/discard", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "discard",
          label: "Discarded file changes",
          execute: async (status, body) => {
            const changes = status.changes.staged.concat(status.changes.unstaged);
            const files = parseGitFilesPayload(body, changes, "Discard");
            await discardFiles(status.worktreePath, files, changes);
            return `Discarded ${describeFileCount(files.length)}`;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/commit", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "commit",
          label: "Committed staged files",
          execute: async (status, body) => {
            const message = assertCanCommit(status, requiredString((body as { message?: unknown })?.message, "Commit message"));
            await commitStagedFiles(status.worktreePath, message);
            return message;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/git/stash", async (request, response, next) => {
    try {
      response.status(202).json(
        await runGitMutation({
          activityLog,
          registry,
          serviceManager,
          projectId: request.params.id,
          body: request.body,
          action: "stash",
          label: "Stashed changes",
          execute: async (status, body) => {
            assertCanStash(status);
            const message = optionalString((body as { message?: unknown })?.message, "Stash message");
            const payload = body as { all?: unknown; files?: unknown };
            const changes = status.changes.staged.concat(status.changes.unstaged);
            const files =
              Array.isArray(payload?.files) || payload?.all === true
                ? parseGitFilesPayload(body, changes, "Stash")
                : undefined;
            await createStash(status.worktreePath, message, files);
            return message ? `Stashed ${message}` : `Stashed changes on ${status.branch}`;
          }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/worktrees/diff", async (request, response, next) => {
    try {
      const worktreePath = request.query.path;
      const filePath = request.query.file;
      if (typeof worktreePath !== "string" || typeof filePath !== "string" || !worktreePath || !filePath) {
        response.status(400).json({ error: "Worktree path and file are required." });
        return;
      }

      const project = (await registry.listProjects()).find((candidate) => candidate.id === request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }

      const snapshot = await snapshotProject(project, serviceManager);
      const worktree = snapshot.worktrees.find((candidate) => samePath(candidate.path, worktreePath));
      if (!worktree) {
        response.status(404).json({ error: "Worktree not found." });
        return;
      }

      const changedFile = worktree.changes?.find((change) => change.path === filePath);
      if (!changedFile) {
        response.status(404).json({ error: "Changed file not found in worktree." });
        return;
      }

      const diff = await readWorktreeFileDiff(worktree.path, filePath, changedFile, 200);
      const payload: WorktreeDiffResponse = {
        worktreePath: worktree.path,
        filePath,
        ...diff
      };
      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:id/worktrees", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      const worktreePath = String(request.body?.path ?? "").trim();
      if (!worktreePath) {
        response.status(400).json({ error: "Worktree path is required." });
        return;
      }

      const snapshot = await snapshotProject(project, serviceManager);
      const worktree = snapshot.worktrees.find((candidate) => samePath(candidate.path, worktreePath));
      if (!worktree) {
        response.status(404).json({ error: "Worktree not found." });
        return;
      }
      if (!worktree.removal?.canDelete) {
        response.status(409).json({ error: worktree.removal?.reasons.join(" ") ?? "Worktree is not safe to remove." });
        return;
      }

      await removeWorktree(project.path, worktree.path);
      await recordActivity(activityLog, {
        action: "worktree.remove",
        label: "Removed worktree",
        ...projectActivity(project),
        targetType: "worktree",
        target: worktree.branch ?? worktree.shortHead ?? "detached",
        detail: worktree.path
      });
      response.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:id/branches/:branch", async (request, response, next) => {
    try {
      const project = await findProject(registry, request.params.id);
      const branch = decodeURIComponent(request.params.branch);
      const snapshot = await snapshotProject(project, serviceManager);
      const branchInfo = snapshot.branches.find((candidate) => candidate.name === branch);
      if (!branchInfo) {
        response.status(404).json({ error: "Branch not found." });
        return;
      }
      if (!branchInfo.removal.canDelete) {
        response.status(409).json({ error: branchInfo.removal.reasons.join(" ") });
        return;
      }

      await deleteBranch(project.path, branchInfo.name);
      await recordActivity(activityLog, {
        action: "branch.delete",
        label: "Deleted branch",
        ...projectActivity(project),
        targetType: "branch",
        target: branchInfo.name,
        detail: branchInfo.removal.reasons.join(" ")
      });
      response.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api(?:\/|$)).*/, async (_request, response, next) => {
      const indexPath = join(staticDir, "index.html");
      try {
        await access(indexPath);
        response.sendFile(indexPath);
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = error instanceof HttpError || error instanceof GitOperationError ? error.status : 500;
    response.status(status).json({ error: error.message });
  });

  return app;
}

function dashboardCacheTtlMs() {
  const timeout = Number(process.env.WORKTREE_CONSOLE_DASHBOARD_CACHE_TTL_MS);
  return Number.isInteger(timeout) && timeout >= 0 ? timeout : DEFAULT_DASHBOARD_CACHE_TTL_MS;
}

export async function snapshotProject(
  project: RegisteredProject,
  serviceManager: ServiceController = new ServiceManager(),
  options: { discoverWorktreeServices?: boolean } = {}
): Promise<ProjectSnapshot> {
  const exists = await pathExists(project.path);
  if (!exists) {
    const services = await snapshotRegisteredServices(project, serviceManager);
    return {
      ...project,
      exists: false,
      isGitRepository: false,
      status: "missing",
      branch: null,
      worktrees: [],
      branches: [],
      recentCommits: [],
      services,
      detectedServices: [],
      serviceGroups: buildServiceGroupSnapshots(project.serviceGroups, services)
    };
  }

  const gitRepository = await isGitRepository(project.path);
  if (!gitRepository) {
    const services = await snapshotRegisteredServices(project, serviceManager);
    return {
      ...project,
      exists: true,
      isGitRepository: false,
      status: "error",
      branch: null,
      worktrees: [],
      branches: [],
      recentCommits: [],
      services,
      detectedServices: [],
      serviceGroups: buildServiceGroupSnapshots(project.serviceGroups, services),
      error: "Path exists but is not a Git repository."
    };
  }

  try {
    const [branch, rawWorktrees, branchNames, mergedBranches, branchTracking, recentCommits] = await Promise.all([
      readBranchStatus(project.path),
      readWorktrees(project.path),
      readBranches(project.path),
      readMergedBranches(project.path),
      readBranchTracking(project.path),
      readRecentCommits(project.path)
    ]);
    const branchTrackingByName = new Map(branchTracking.map((tracking) => [tracking.name, tracking]));
    const worktreePaths = rawWorktrees.map((worktree) => worktree.path);
    const [worktrees, services] = await Promise.all([
      Promise.all(rawWorktrees.map(async (worktree) => {
        try {
          const trackedTipCommitAt = worktree.branch ? branchTrackingByName.get(worktree.branch)?.lastCommitAt : undefined;
          const [changes, shortHead, baseRefs, loggedCommitAt] = await Promise.all([
            readWorktreeChanges(worktree.path),
            readShortHead(worktree.path),
            readContainingBranches(worktree.path),
            trackedTipCommitAt === undefined
              ? readLastCommitTimestamp(worktree.path)
              : Promise.resolve(null)
          ]);
          const lastCommitAt = trackedTipCommitAt ?? loggedCommitAt ?? null;
          const changesMtime = await readChangesLatestMtime(worktree.path, changes);
          const lastActivityAt = latestTimestamp(lastCommitAt, changesMtime);
          const enrichedWorktree = {
            ...worktree,
            shortHead,
            baseRefs,
            clean: changes.length === 0,
            dirtyFiles: changes.length,
            changes,
            lastActivityAt
          };
          return {
            ...enrichedWorktree,
            removal: assessWorktreeRemoval(enrichedWorktree, project.path)
          };
        } catch (error) {
          return {
            ...worktree,
            shortHead: worktree.head?.slice(0, 7) ?? null,
            baseRefs: [],
            clean: false,
            dirtyFiles: 0,
            changes: [],
            lastActivityAt: null,
            removal: {
              level: "review" as const,
              label: "Review",
              reasons: [`Git status unavailable for this worktree: ${(error as Error).message}`],
              canDelete: false
            }
          };
        }
      })),
      snapshotRegisteredServices(project, serviceManager, worktreePaths)
    ]);
    const detectedServices = options.discoverWorktreeServices && serviceManager.discoverWorktreeServices
      ? await serviceManager.discoverWorktreeServices(rawWorktrees, services).catch(() => [])
      : [];
    const serviceGroups = buildServiceGroupSnapshots(project.serviceGroups, services);
    const branches = sortBranchesByRecentActivity(branchNames.map((branchName) => {
      const tracking = branchTrackingByName.get(branchName);
      return {
        ...buildBranchInfo({
          branch: branchName,
          currentBranch: branch.branch,
          mergedBranches,
          worktrees
        }),
        lastCommitAt: tracking?.lastCommitAt ?? null,
        ...(tracking
          ? {
              upstream: tracking.upstream,
              upstreamGone: tracking.upstreamGone,
              ahead: tracking.ahead,
              behind: tracking.behind
            }
          : {})
      };
    }));

    return {
      ...project,
      exists: true,
      isGitRepository: true,
      status: branch.clean ? "clean" : "dirty",
      branch,
      worktrees: sortWorktreesByRecentActivity(worktrees),
      branches,
      recentCommits,
      services,
      detectedServices,
      serviceGroups
    };
  } catch (error) {
    const services = await snapshotRegisteredServices(project, serviceManager);
    return {
      ...project,
      exists: true,
      isGitRepository: true,
      status: "error",
      branch: null,
      worktrees: [],
      branches: [],
      recentCommits: [],
      services,
      detectedServices: [],
      serviceGroups: buildServiceGroupSnapshots(project.serviceGroups, services),
      error: (error as Error).message
    };
  }
}

function latestTimestamp(...timestamps: (number | null)[]): number | null {
  const valid = timestamps.filter((timestamp): timestamp is number => timestamp !== null);
  return valid.length ? Math.max(...valid) : null;
}

async function snapshotRegisteredServices(
  project: RegisteredProject,
  serviceManager: ServiceController,
  worktreePaths: string[] = []
): Promise<ServiceSnapshot[]> {
  return Promise.all(
    project.services.map((service) => serviceManager.snapshot(project.id, service, project.path, worktreePaths))
  );
}

async function readServiceWorktreePaths(projectPath: string): Promise<string[]> {
  try {
    if (!(await isGitRepository(projectPath))) return [];
    return (await readWorktrees(projectPath)).map((worktree) => worktree.path);
  } catch {
    return [];
  }
}

async function runGitMutation(options: GitMutationOptions): Promise<GitOperationResponse> {
  let project: RegisteredProject | null = null;
  let status: GitOperationStatus | null = null;

  try {
    project = await findProject(options.registry, options.projectId);
    const snapshot = await snapshotProject(project, options.serviceManager);
    status = await buildGitOperationStatus(project, snapshot, bodyPath(options.body));
    const detail = await options.execute(status, options.body);
    const refreshedSnapshot = await snapshotProject(project, options.serviceManager);
    const refreshedStatus = await buildGitOperationStatus(project, refreshedSnapshot, status.worktreePath);

    await recordGitOperationActivity(options.activityLog, project, {
      action: options.action,
      label: options.label,
      target: status.worktreePath,
      status: "success",
      detail
    });

    return { ok: true, status: refreshedStatus };
  } catch (error) {
    if (project) {
      await recordGitOperationActivity(options.activityLog, project, {
        action: options.action,
        label: options.label,
        target: status?.worktreePath ?? project.path,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

async function recordGitOperationActivity(
  activityLog: ActivityRecorder,
  project: RegisteredProject,
  input: {
    action: GitMutationAction;
    label: string;
    target: string;
    status: ActivityEvent["status"];
    detail: string;
  }
): Promise<void> {
  await recordActivity(activityLog, {
    action: `git.${input.action}`,
    label: input.label,
    ...projectActivity(project),
    targetType: "git",
    target: input.target,
    status: input.status,
    detail: input.detail
  });
}

function queryPath(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string") {
    throw new GitOperationError(400, "Git target path must be a string.");
  }
  return input.trim() || undefined;
}

function bodyPath(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !Object.hasOwn(body, "path")) {
    return undefined;
  }

  const path = (body as { path?: unknown }).path;
  if (path === undefined || path === null || path === "") {
    return undefined;
  }
  if (typeof path !== "string") {
    throw new GitOperationError(400, "Git target path must be a string.");
  }
  return path.trim() || undefined;
}

function requiredString(input: unknown, label: string): string {
  if (typeof input !== "string") {
    throw new GitOperationError(400, `${label} must be a string.`);
  }
  return input;
}

function optionalString(input: unknown, label: string): string | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }
  if (typeof input !== "string") {
    throw new GitOperationError(400, `${label} must be a string.`);
  }
  return input.trim() || undefined;
}

function buildDashboardResponse(projects: ProjectSnapshot[]): DashboardResponse {
  const sortedProjects = [...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));

  return {
    projects: sortedProjects,
    summary: {
      projects: sortedProjects.length,
      worktrees: sortedProjects.reduce((sum, project) => sum + project.worktrees.length, 0),
      services: sortedProjects.reduce((sum, project) => sum + project.services.length, 0),
      runningServices: sortedProjects.reduce(
        (sum, project) => sum + project.services.filter((service) => service.status === "running").length,
        0
      ),
      dirty: sortedProjects.filter((project) => project.status === "dirty").length,
      missing: sortedProjects.filter((project) => project.status === "missing").length,
      clean: sortedProjects.filter((project) => project.status === "clean").length
    },
    health: buildHealthSummary(sortedProjects)
  };
}

async function recordActivity(activityLog: ActivityRecorder, input: ActivityInput): Promise<void> {
  try {
    await activityLog.record(input);
  } catch (error) {
    console.warn(`Failed to write activity log: ${(error as Error).message}`);
  }
}

function projectActivity(project: RegisteredProject): Pick<ActivityEvent, "projectId" | "projectName" | "projectPath"> {
  return {
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path
  };
}

function buildServiceGroupSnapshots(
  groups: RegisteredServiceGroup[],
  services: ServiceSnapshot[]
): ServiceGroupSnapshot[] {
  const servicesById = new Map(services.map((service) => [service.id, service]));

  return groups.map((group) => {
    const groupServices = group.serviceIds
      .map((serviceId) => servicesById.get(serviceId))
      .filter((service): service is ServiceSnapshot => Boolean(service));

    return {
      ...group,
      services: groupServices,
      status: groupStatus(group, groupServices)
    };
  });
}

function groupStatus(group: RegisteredServiceGroup, services: ServiceSnapshot[]): ServiceGroupStatus {
  if (services.length === 0 || services.length !== group.serviceIds.length) {
    return "error";
  }
  if (services.some((service) => service.status === "error" || service.status === "port-occupied")) {
    return "error";
  }
  if (services.every((service) => service.status === "running" || service.status === "starting")) {
    return "running";
  }
  if (services.every((service) => service.status === "stopped")) {
    return "stopped";
  }
  return "partial";
}

async function findProjectServiceGroup(
  registry: ProjectRegistry,
  projectId: string,
  groupId: string
): Promise<{ project: RegisteredProject; group: RegisteredServiceGroup }> {
  const project = await findProject(registry, projectId);
  const group = project.serviceGroups.find((candidate) => candidate.id === groupId);
  if (!group) {
    throw new HttpError(404, "Service group not found.");
  }
  return { project, group };
}

async function findProjectServiceGroupServices(
  registry: ProjectRegistry,
  projectId: string,
  groupId: string
): Promise<{ project: RegisteredProject; group: RegisteredServiceGroup; services: RegisteredService[] }> {
  const { project, group } = await findProjectServiceGroup(registry, projectId, groupId);
  const servicesById = new Map(project.services.map((service) => [service.id, service]));
  const missingServiceIds = group.serviceIds.filter((serviceId) => !servicesById.has(serviceId));
  const services = group.serviceIds
    .map((serviceId) => servicesById.get(serviceId))
    .filter((service): service is RegisteredService => Boolean(service));

  if (services.length === 0) {
    throw new HttpError(400, "Service group has no services.");
  }
  if (missingServiceIds.length > 0) {
    throw new HttpError(400, `Service group references unknown service ids: ${missingServiceIds.join(", ")}.`);
  }

  return { project, group, services };
}

async function runServiceGroupAction(
  serviceManager: ServiceController,
  projectId: string,
  projectPath: string,
  group: RegisteredServiceGroup,
  services: RegisteredService[],
  action: ServiceGroupAction
): Promise<ServiceGroupActionResponse> {
  const results: ServiceGroupActionResult[] = [];
  const worktreePaths = action === "start" ? [] : await readServiceWorktreePaths(projectPath);

  if (action === "start") {
    await runServiceGroupOperation(serviceManager, projectId, projectPath, worktreePaths, services, "start", results);
  } else if (action === "stop") {
    await runServiceGroupOperation(serviceManager, projectId, projectPath, worktreePaths, [...services].reverse(), "stop", results);
  } else {
    await runServiceGroupOperation(serviceManager, projectId, projectPath, worktreePaths, [...services].reverse(), "stop", results);
    await runServiceGroupOperation(serviceManager, projectId, projectPath, worktreePaths, services, "start", results);
  }

  return {
    groupId: group.id,
    groupName: group.name,
    action,
    results,
    errors: results.filter((result) => !result.ok)
  };
}

async function runServiceGroupOperation(
  serviceManager: ServiceController,
  projectId: string,
  projectPath: string,
  worktreePaths: string[],
  services: RegisteredService[],
  operation: ServiceGroupActionOperation,
  results: ServiceGroupActionResult[]
): Promise<void> {
  for (const service of services) {
    try {
      const snapshot = await serviceManager[operation](projectId, service, projectPath, worktreePaths);
      results.push({
        serviceId: service.id,
        serviceName: service.name,
        operation,
        ok: true,
        snapshot
      });
    } catch (error) {
      results.push({
        serviceId: service.id,
        serviceName: service.name,
        operation,
        ok: false,
        error: (error as Error).message
      });
    }
  }
}

async function recordServiceGroupActionActivity(
  activityLog: ActivityRecorder,
  project: RegisteredProject,
  group: RegisteredServiceGroup,
  payload: ServiceGroupActionResponse
): Promise<void> {
  const failed = payload.errors.length;
  const succeeded = payload.results.length - failed;
  const labels: Record<ServiceGroupAction, string> = {
    start: "Started service group",
    stop: "Stopped service group",
    restart: "Restarted service group"
  };

  await recordActivity(activityLog, {
    action: `service-group.${payload.action}`,
    label: labels[payload.action],
    ...projectActivity(project),
    targetType: "service-group",
    target: group.name,
    status: failed > 0 ? "failed" : "success",
    detail: failed > 0 ? `${failed} failed, ${succeeded} succeeded` : `${succeeded} succeeded`
  });
}

async function findProjectService(registry: ProjectRegistry, projectId: string, serviceId: string) {
  const project = await findProject(registry, projectId);
  const service = project.services.find((candidate) => candidate.id === serviceId);
  if (!service) {
    throw new HttpError(404, "Service not found.");
  }
  return { project, service };
}

function parseServiceIds(input: unknown): string[] | null {
  if (!Array.isArray(input)) {
    return null;
  }
  return input.map(String).map((serviceId) => serviceId.trim()).filter(Boolean);
}

function parsePorts(input: unknown): number[] {
  const rawPorts = Array.isArray(input)
    ? input
    : String(input ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  return Array.from(
    new Set(
      rawPorts
        .map(Number)
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    )
  );
}

async function findProject(registry: ProjectRegistry, id: string): Promise<RegisteredProject> {
  const project = (await registry.listProjects()).find((candidate) => candidate.id === id);
  if (!project) {
    throw new HttpError(404, "Project not found.");
  }
  return project;
}

function mapRegistryError(error: unknown): Error {
  if (error instanceof HttpError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Project not found")) {
    return new HttpError(404, "Project not found.");
  }
  if (message.startsWith("Service group not found")) {
    return new HttpError(404, "Service group not found.");
  }
  if (
    message.startsWith("Service group name is required") ||
    message.startsWith("Service group requires") ||
    message.startsWith("Unknown service id")
  ) {
    return new HttpError(400, message.endsWith(".") ? message : `${message}.`);
  }

  return error instanceof Error ? error : new Error(message);
}

function describeServiceCount(count: number): string {
  return `${count} service${count === 1 ? "" : "s"}`;
}

function describeFileCount(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function openPath(path: string) {
  if (process.platform === "win32") {
    spawn("explorer.exe", [path], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [path], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function openTerminal(path: string) {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", "wt", "-d", path], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }
  spawn(process.platform === "darwin" ? "open" : "x-terminal-emulator", [path], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function samePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string) {
  try {
    return realpathSync.native(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  } catch {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
}
