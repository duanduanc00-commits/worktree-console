import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type { RegisteredProject, RegisteredService } from "../shared/types";

type RegistryFile = {
  projects: RegisteredProject[];
};

export type AddProjectInput = {
  name: string;
  path: string;
  tags?: string[];
  pinned?: boolean;
};

export type UpdateProjectInput = Partial<Pick<RegisteredProject, "name" | "path" | "tags" | "pinned">>;

export type AddServiceInput = {
  name: string;
  cwd: string;
  command: string;
  ports?: number[];
  healthUrl?: string | null;
};

export class ProjectRegistry {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async listProjects(): Promise<RegisteredProject[]> {
    await this.mutationQueue;
    return (await this.read()).projects;
  }

  async addProject(input: AddProjectInput): Promise<RegisteredProject> {
    return this.enqueueMutation(async () => {
    const registry = await this.read();
    const now = new Date().toISOString();
    const project: RegisteredProject = {
      id: randomUUID(),
      name: input.name.trim(),
      path: input.path.trim(),
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      services: [],
      createdAt: now,
      updatedAt: now
    };

    registry.projects.push(project);
    await this.write(registry);
    return project;
    });
  }

  async updateProject(id: string, input: UpdateProjectInput): Promise<RegisteredProject> {
    return this.enqueueMutation(async () => {
    const registry = await this.read();
    const index = registry.projects.findIndex((project) => project.id === id);
    if (index === -1) {
      throw new Error(`Project not found: ${id}`);
    }

    const updated = {
      ...registry.projects[index],
      ...input,
      updatedAt: new Date().toISOString()
    };
    registry.projects[index] = updated;
    await this.write(registry);
    return updated;
    });
  }

  async addService(projectId: string, input: AddServiceInput): Promise<RegisteredService> {
    return this.enqueueMutation(async () => {
    const registry = await this.read();
    const project = registry.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const now = new Date().toISOString();
    const service: RegisteredService = {
      id: randomUUID(),
      name: input.name.trim(),
      cwd: input.cwd.trim(),
      command: input.command.trim(),
      ports: sanitizePorts(input.ports ?? []),
      healthUrl: input.healthUrl?.trim() || null,
      createdAt: now,
      updatedAt: now
    };

    project.services.push(service);
    project.updatedAt = now;
    await this.write(registry);
    return service;
    });
  }

  async removeService(projectId: string, serviceId: string): Promise<void> {
    return this.enqueueMutation(async () => {
    const registry = await this.read();
    const project = registry.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    project.services = project.services.filter((service) => service.id !== serviceId);
    project.updatedAt = new Date().toISOString();
    await this.write(registry);
    });
  }

  async removeProject(id: string): Promise<void> {
    return this.enqueueMutation(async () => {
    const registry = await this.read();
    registry.projects = registry.projects.filter((project) => project.id !== id);
    await this.write(registry);
    });
  }

  private async read(): Promise<RegistryFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeRegistry(JSON.parse(raw) as RegistryFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { projects: [] };
      }
      throw error;
    }
  }

  private async write(registry: RegistryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function normalizeRegistry(registry: RegistryFile): RegistryFile {
  return {
    projects: (registry.projects ?? []).map((project) => ({
      ...project,
      tags: project.tags ?? [],
      pinned: project.pinned ?? false,
      services: (project.services ?? []).map((service) => ({
        ...service,
        ports: sanitizePorts(service.ports ?? []),
        healthUrl: service.healthUrl ?? null
      }))
    }))
  };
}

function sanitizePorts(ports: number[]): number[] {
  return Array.from(
    new Set(
      ports
        .map(Number)
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    )
  );
}
