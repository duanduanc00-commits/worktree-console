import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActivityLog } from "../src/server/activity";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "worktree-console-activity-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ActivityLog", () => {
  it("records newest events first", async () => {
    const log = new ActivityLog(join(tempDir, "activity.json"));

    await log.record({
      action: "project.add",
      label: "Added project",
      projectName: "First",
      targetType: "project",
      target: "First"
    });
    await log.record({
      action: "branch.delete",
      label: "Deleted branch",
      projectName: "First",
      targetType: "branch",
      target: "feature/demo"
    });

    const events = await log.list();

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: "branch.delete",
      label: "Deleted branch",
      status: "success",
      target: "feature/demo"
    });
    expect(events[1]).toMatchObject({
      action: "project.add",
      target: "First"
    });
  });

  it("keeps the configured maximum number of events", async () => {
    const log = new ActivityLog(join(tempDir, "activity.json"), 2);

    await log.record({ action: "one", label: "One" });
    await log.record({ action: "two", label: "Two" });
    await log.record({ action: "three", label: "Three" });

    expect((await log.list()).map((event) => event.action)).toEqual(["three", "two"]);
  });
});
