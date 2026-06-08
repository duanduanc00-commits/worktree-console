import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "../src/server/concurrency";

describe("mapWithConcurrency", () => {
  it("limits concurrently running async tasks while preserving result order", async () => {
    let running = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return item * 10;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });
});
