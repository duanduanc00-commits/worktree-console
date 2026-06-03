import { spawn } from "node:child_process";
import { basename, join } from "node:path";

import express from "express";

import {
  isGitRepository,
  pathExists,
  deleteBranch,
  readBranches,
  readBranchStatus,
  readContainingBranches,
  readMergedBranches,
  readRecentCommits,
  readShortHead,
  readWorktreeChanges,
  readWorktrees,
  removeWorktree
} from "./git";
import { ActivityLog, type ActivityInput } from "./activity";
import { ProjectRegistry } from "./registry";
import { assessWorktreeRemoval, buildBranchInfo } from "./safety";
import { ServiceManager } from "./services";
import { selectFolder as selectLocalFolder } from "./folderPicker";
import type { ActivityEvent, DashboardResponse, ProjectSnapshot, RegisteredProject, RegisteredService, ServiceSnapshot } from "../shared/types";

export type AppDependencies = {
  registry: ProjectRegistry;
  activityLog?: ActivityRecorder;
  serviceManager?: ServiceController;
  selectFolder?: () => Promise<string | null>;
};

type ActivityRecorder = {
  list(limit?: number): Promise<ActivityEvent[]>;
  record(input: ActivityInput): Promise<ActivityEvent>;
};

type ServiceController = {
  snapshot(projectId: string, service: RegisteredService): Promise<ServiceSnapshot>;
  start(projectId: string, service: RegisteredService): Promise<ServiceSnapshot>;
  stop(projectId: string, service: RegisteredService): Promise<ServiceSnapshot>;
  restart(projectId: string, service: RegisteredService): Promise<ServiceSnapshot>;
  logs(projectId: string, serviceId: string): Promise<string[]>;
};

export function createApp({
  activityLog = new ActivityLog(join(process.cwd(), "data", "activity-log.json")),
  registry,
  serviceManager = new ServiceManager(),
  selectFolder = selectLocalFolder
}: AppDependencies) {
  const app = express();
  app.use(express.json());

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

  app.get("/api/projects", async (_request, response, next) => {
    try {
      const projects = await registry.listProjects();
      const snapshots = await Promise.all(projects.map((project) => snapshotProject(project, serviceManager)));
      response.json(buildDashboardResponse(snapshots));
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
      response.json(
        await readRecentCommits(project.path, {
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
      const snapshot = await serviceManager.stop(project.id, service);
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
      const snapshot = await serviceManager.restart(project.id, service);
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

  app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ error: error.message });
  });

  return app;
}

export async function snapshotProject(
  project: RegisteredProject,
  serviceManager: ServiceController = new ServiceManager()
): Promise<ProjectSnapshot> {
  const services = await Promise.all(project.services.map((service) => serviceManager.snapshot(project.id, service)));
  const exists = await pathExists(project.path);
  if (!exists) {
    return {
      ...project,
      exists: false,
      isGitRepository: false,
      status: "missing",
      branch: null,
      worktrees: [],
      branches: [],
      recentCommits: [],
      services
    };
  }

  const gitRepository = await isGitRepository(project.path);
  if (!gitRepository) {
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
      error: "Path exists but is not a Git repository."
    };
  }

  try {
    const [branch, rawWorktrees, branchNames, mergedBranches, recentCommits] = await Promise.all([
      readBranchStatus(project.path),
      readWorktrees(project.path),
      readBranches(project.path),
      readMergedBranches(project.path),
      readRecentCommits(project.path)
    ]);
    const worktrees = await Promise.all(
      rawWorktrees.map(async (worktree) => {
        const [changes, shortHead, baseRefs] = await Promise.all([
          readWorktreeChanges(worktree.path),
          readShortHead(worktree.path),
          readContainingBranches(worktree.path)
        ]);
        const enrichedWorktree = {
          ...worktree,
          shortHead,
          baseRefs,
          clean: changes.length === 0,
          dirtyFiles: changes.length,
          changes
        };
        return {
          ...enrichedWorktree,
          removal: assessWorktreeRemoval(enrichedWorktree, project.path)
        };
      })
    );
    const branches = branchNames.map((branchName) =>
      buildBranchInfo({
        branch: branchName,
        currentBranch: branch.branch,
        mergedBranches,
        worktrees
      })
    );

    return {
      ...project,
      exists: true,
      isGitRepository: true,
      status: branch.clean ? "clean" : "dirty",
      branch,
      worktrees,
      branches,
      recentCommits,
      services
    };
  } catch (error) {
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
      error: (error as Error).message
    };
  }
}

function buildDashboardResponse(projects: ProjectSnapshot[]): DashboardResponse {
  return {
    projects: projects.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)),
    summary: {
      projects: projects.length,
      worktrees: projects.reduce((sum, project) => sum + project.worktrees.length, 0),
      services: projects.reduce((sum, project) => sum + project.services.length, 0),
      runningServices: projects.reduce(
        (sum, project) => sum + project.services.filter((service) => service.status === "running").length,
        0
      ),
      dirty: projects.filter((project) => project.status === "dirty").length,
      missing: projects.filter((project) => project.status === "missing").length,
      clean: projects.filter((project) => project.status === "clean").length
    }
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

async function findProjectService(registry: ProjectRegistry, projectId: string, serviceId: string) {
  const project = await findProject(registry, projectId);
  const service = project.services.find((candidate) => candidate.id === serviceId);
  if (!service) {
    throw new Error(`Service not found: ${serviceId}`);
  }
  return { project, service };
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
    throw new Error(`Project not found: ${id}`);
  }
  return project;
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
  return left.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() ===
    right.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
