import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "../src/server/registry";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "worktree-console-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ProjectRegistry", () => {
  it("adds, lists, updates, and removes registered projects", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects.json"));

    const added = await registry.addProject({
      name: "Console",
      path: "C:/Dev/console",
      tags: ["internal"]
    });

    expect(await registry.listProjects()).toEqual([
      {
        id: added.id,
        name: "Console",
        path: "C:/Dev/console",
        tags: ["internal"],
        pinned: false,
        services: [],
        serviceGroups: [],
        createdAt: added.createdAt,
        updatedAt: added.updatedAt
      }
    ]);

    const service = await registry.addService(added.id, {
      name: "Admin",
      cwd: "C:/Dev/console",
      command: "npm run admin",
      ports: [5273],
      healthUrl: "http://127.0.0.1:5273"
    });
    expect((await registry.listProjects())[0].services).toEqual([
      {
        id: service.id,
        name: "Admin",
        cwd: "C:/Dev/console",
        command: "npm run admin",
        ports: [5273],
        healthUrl: "http://127.0.0.1:5273",
        createdAt: service.createdAt,
        updatedAt: service.updatedAt
      }
    ]);

    await registry.removeService(added.id, service.id);
    expect((await registry.listProjects())[0].services).toEqual([]);

    await registry.updateProject(added.id, { pinned: true, tags: ["internal", "tool"] });
    expect((await registry.listProjects())[0]).toMatchObject({
      pinned: true,
      tags: ["internal", "tool"]
    });

    await registry.removeProject(added.id);
    expect(await registry.listProjects()).toEqual([]);
  });

  it("stores and normalizes service groups", async () => {
    const registryPath = join(tempDir, "projects-groups.json");
    await writeFile(
      registryPath,
      JSON.stringify({
        projects: [
          {
            id: "legacy-project",
            name: "Legacy",
            path: "C:/Dev/legacy",
            tags: ["old"],
            pinned: true,
            services: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }),
      "utf8"
    );

    const registry = new ProjectRegistry(registryPath);

    expect((await registry.listProjects())[0].serviceGroups).toEqual([]);

    const serviceA = await registry.addService("legacy-project", {
      name: "API",
      cwd: "C:/Dev/legacy",
      command: "npm run api",
      ports: [5100],
      healthUrl: null
    });
    const serviceB = await registry.addService("legacy-project", {
      name: "Worker",
      cwd: "C:/Dev/legacy",
      command: "npm run worker",
      ports: [5101],
      healthUrl: null
    });

    const group = await registry.addServiceGroup("legacy-project", {
      name: " Core Services ",
      serviceIds: [serviceA.id, serviceA.id, serviceB.id]
    });

    expect(group).toEqual({
      id: group.id,
      name: "Core Services",
      serviceIds: [serviceA.id, serviceB.id],
      createdAt: group.createdAt,
      updatedAt: group.updatedAt
    });

    const updated = await registry.updateServiceGroup("legacy-project", group.id, {
      serviceIds: [serviceB.id, serviceB.id]
    });

    expect(updated).toEqual({
      ...group,
      serviceIds: [serviceB.id],
      updatedAt: updated.updatedAt
    });
    expect(updated.name).toBe("Core Services");
    expect((await registry.listProjects())[0].serviceGroups).toEqual([updated]);

    await registry.removeServiceGroup("legacy-project", group.id);
    expect((await registry.listProjects())[0].serviceGroups).toEqual([]);
  });

  it("rejects unknown service ids and empty service groups", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects-invalid-groups.json"));
    const project = await registry.addProject({
      name: "Console",
      path: "C:/Dev/console"
    });
    const service = await registry.addService(project.id, {
      name: "API",
      cwd: "C:/Dev/console",
      command: "npm run api",
      ports: [5200],
      healthUrl: null
    });

    await expect(
      registry.addServiceGroup(project.id, {
        name: "Missing",
        serviceIds: ["missing-service"]
      })
    ).rejects.toThrow("Unknown service id");

    await expect(
      registry.addServiceGroup(project.id, {
        name: "Empty",
        serviceIds: []
      })
    ).rejects.toThrow("at least one service");

    const group = await registry.addServiceGroup(project.id, {
      name: "API",
      serviceIds: [service.id]
    });

    await expect(
      registry.updateServiceGroup(project.id, group.id, {
        serviceIds: []
      })
    ).rejects.toThrow("at least one service");

    await expect(
      registry.updateServiceGroup(project.id, group.id, {
        name: "   "
      })
    ).rejects.toThrow("Service group name is required");
  });

  it("removing a service safely updates service group membership", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects-remove-service-groups.json"));
    const project = await registry.addProject({
      name: "Console",
      path: "C:/Dev/console"
    });
    const api = await registry.addService(project.id, {
      name: "API",
      cwd: "C:/Dev/console",
      command: "npm run api",
      ports: [5200],
      healthUrl: null
    });
    const worker = await registry.addService(project.id, {
      name: "Worker",
      cwd: "C:/Dev/console",
      command: "npm run worker",
      ports: [5201],
      healthUrl: null
    });
    const apiOnly = await registry.addServiceGroup(project.id, {
      name: "API Only",
      serviceIds: [api.id]
    });
    const allServices = await registry.addServiceGroup(project.id, {
      name: "All",
      serviceIds: [api.id, worker.id]
    });

    await registry.removeService(project.id, api.id);

    const storedProject = (await registry.listProjects())[0];
    expect(storedProject.services.map((service) => service.id)).toEqual([worker.id]);
    expect(storedProject.serviceGroups).toEqual([
      {
        id: allServices.id,
        name: allServices.name,
        serviceIds: [worker.id],
        createdAt: allServices.createdAt,
        updatedAt: expect.any(String)
      }
    ]);
    expect(storedProject.serviceGroups).not.toContainEqual(expect.objectContaining({ id: apiOnly.id }));
  });

  it("preserves concurrent service registrations for the same project", async () => {
    const registry = new ProjectRegistry(join(tempDir, "projects-concurrent.json"));
    const project = await registry.addProject({
      name: "Console",
      path: "C:/Dev/console"
    });

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        registry.addService(project.id, {
          name: `Service ${index}`,
          cwd: "C:/Dev/console",
          command: `npm run service-${index}`,
          ports: [5200 + index],
          healthUrl: null
        })
      )
    );

    const services = (await registry.listProjects())[0].services;
    expect(services).toHaveLength(10);
    expect(services.map((service) => service.name).sort()).toEqual(
      Array.from({ length: 10 }, (_, index) => `Service ${index}`).sort()
    );
  });
});
