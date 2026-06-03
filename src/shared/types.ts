export type RegisteredProject = {
  id: string;
  name: string;
  path: string;
  tags: string[];
  pinned: boolean;
  services: RegisteredService[];
  createdAt: string;
  updatedAt: string;
};

export type RegisteredService = {
  id: string;
  name: string;
  cwd: string;
  command: string;
  ports: number[];
  healthUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BranchStatus = {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirtyFiles: number;
  clean: boolean;
};

export type WorktreeInfo = {
  path: string;
  head: string | null;
  shortHead?: string | null;
  branch: string | null;
  detached: boolean;
  baseRefs?: string[];
  removal?: RemovalAssessment;
  clean?: boolean;
  dirtyFiles?: number;
  changes?: WorktreeChange[];
};

export type BranchInfo = {
  name: string;
  current: boolean;
  protected: boolean;
  merged: boolean;
  usedByWorktree: boolean;
  removal: RemovalAssessment;
};

export type RemovalAssessment = {
  level: "safe" | "review" | "blocked";
  label: string;
  reasons: string[];
  canDelete: boolean;
};

export type WorktreeChange = {
  code: string;
  path: string;
  raw: string;
};

export type RecentCommit = {
  hash: string;
  subject: string;
  author: string;
  relativeTime: string;
};

export type ServicePortStatus = {
  port: number;
  listening: boolean;
  pid: number | null;
  processName: string | null;
};

export type ServiceSnapshot = RegisteredService & {
  status: "running" | "stopped" | "starting" | "error" | "port-occupied";
  startedByConsole: boolean;
  pid: number | null;
  portsStatus: ServicePortStatus[];
  logPreview: string[];
  error?: string;
};

export type ProjectSnapshot = Omit<RegisteredProject, "services"> & {
  exists: boolean;
  isGitRepository: boolean;
  status: "clean" | "dirty" | "missing" | "error";
  branch: BranchStatus | null;
  worktrees: WorktreeInfo[];
  branches: BranchInfo[];
  recentCommits: RecentCommit[];
  services: ServiceSnapshot[];
  error?: string;
};

export type DashboardSummary = {
  projects: number;
  worktrees: number;
  services: number;
  runningServices: number;
  dirty: number;
  missing: number;
  clean: number;
};

export type DashboardResponse = {
  projects: ProjectSnapshot[];
  summary: DashboardSummary;
};
