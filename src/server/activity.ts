import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ActivityEvent } from "../shared/types";

type ActivityLogFile = {
  events: ActivityEvent[];
};

export type ActivityInput = Omit<ActivityEvent, "id" | "createdAt" | "status"> & {
  status?: ActivityEvent["status"];
};

export class ActivityLog {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxEvents = 500
  ) {}

  async list(limit = 100): Promise<ActivityEvent[]> {
    await this.mutationQueue;
    return (await this.read()).events.slice(0, clampLimit(limit, this.maxEvents));
  }

  async record(input: ActivityInput): Promise<ActivityEvent> {
    return this.enqueueMutation(async () => {
      const log = await this.read();
      const event: ActivityEvent = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        status: input.status ?? "success",
        ...input
      };

      log.events = [event, ...log.events].slice(0, this.maxEvents);
      await this.write(log);
      return event;
    });
  }

  private async read(): Promise<ActivityLogFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeActivityLog(JSON.parse(raw) as ActivityLogFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { events: [] };
      }
      throw error;
    }
  }

  private async write(log: ActivityLogFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(log, null, 2)}\n`, "utf8");
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

function normalizeActivityLog(log: ActivityLogFile): ActivityLogFile {
  return {
    events: (log.events ?? [])
      .filter((event) => event.id && event.createdAt && event.action && event.label)
      .map((event) => ({
        ...event,
        status: event.status === "failed" ? "failed" : "success",
        projectId: event.projectId ?? null,
        projectName: event.projectName ?? null,
        projectPath: event.projectPath ?? null,
        targetType: event.targetType ?? null,
        target: event.target ?? null,
        detail: event.detail ?? null
      }))
  };
}

function clampLimit(limit: number, maxEvents: number) {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(maxEvents, Math.max(1, Math.floor(limit)));
}
