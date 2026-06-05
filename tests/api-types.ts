import { runGitOperation } from "../src/lib/api";

declare const projectId: string;

void runGitOperation(projectId, "fetch", {});
void runGitOperation(projectId, "stage", { path: "repo", files: ["src/App.tsx"] });
void runGitOperation(projectId, "stage", { all: true });
void runGitOperation(projectId, "commit", { path: "repo", message: "Ship it" });
void runGitOperation(projectId, "stash", { path: "repo", message: null });

// @ts-expect-error Commit operations require a message.
void runGitOperation(projectId, "commit", { path: "repo" });

// @ts-expect-error Stage operations require selected files or all files.
void runGitOperation(projectId, "stage", { path: "repo" });

// @ts-expect-error File selection operations cannot combine explicit files with all files.
void runGitOperation(projectId, "unstage", { all: true, files: ["src/App.tsx"] });

// @ts-expect-error Fetch operations only accept the target path payload.
void runGitOperation(projectId, "fetch", { message: "Nope" });
