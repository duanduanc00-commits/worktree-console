import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commitStagedFiles,
  createStash,
  parseStashList,
  readStashes,
  stageFiles,
  unstageFiles
} from "../src/server/git";

const execFileAsync = promisify(execFile);

let tempDir: string;
let repoPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "worktree-console-gitops-"));
  repoPath = join(tempDir, "repo");
  await git(tempDir, ["init", repoPath]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
  await writeFile(join(repoPath, "README.md"), "base\n");
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "Initial commit"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("git operation helpers", () => {
  it("stages, unstages, and commits files without shell interpolation", async () => {
    await writeFile(join(repoPath, "README.md"), "changed\n");

    await stageFiles(repoPath, ["README.md"]);
    expect((await git(repoPath, ["diff", "--cached", "--name-only"])).stdout.trim()).toBe("README.md");

    await unstageFiles(repoPath, ["README.md"]);
    expect((await git(repoPath, ["diff", "--cached", "--name-only"])).stdout.trim()).toBe("");

    await stageFiles(repoPath, ["README.md"]);
    await commitStagedFiles(repoPath, "Update readme; echo nope");

    expect((await git(repoPath, ["log", "-1", "--pretty=%s"])).stdout.trim()).toBe("Update readme; echo nope");
  });

  it("creates and reads stashes", async () => {
    await writeFile(join(repoPath, "README.md"), "stash me\n");
    const branch = (await git(repoPath, ["branch", "--show-current"])).stdout.trim();

    await createStash(repoPath, "draft changes");

    expect(await readStashes(repoPath)).toEqual([
      expect.objectContaining({
        index: 0,
        name: "stash@{0}",
        branch,
        message: expect.stringContaining("draft changes")
      })
    ]);
  });

  it("parses stash subjects that do not include an On branch prefix", () => {
    expect(parseStashList("stash@{3}\u001fWIP without branch prefix\n")).toEqual([
      {
        index: 3,
        name: "stash@{3}",
        branch: null,
        message: "WIP without branch prefix"
      }
    ]);
  });
});

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, windowsHide: true, timeout: 12000 });
}
