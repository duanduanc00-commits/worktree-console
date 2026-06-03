import { mkdtemp, rm } from "node:fs/promises";
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
