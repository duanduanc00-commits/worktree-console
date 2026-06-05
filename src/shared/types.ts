export type RegisteredProject = {
  id: string;
  name: string;
  path: string;
  tags: string[];
  pinned: boolean;
  services: RegisteredService[];
  serviceGroups: RegisteredServiceGroup[];
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

export type RegisteredServiceGroup = {
  id: string;
  name: string;
  serviceIds: string[];
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
  upstream?: string | null;
  upstreamGone?: boolean;
  ahead?: number;
  behind?: number;
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

export type GitOperationChangeGroups = {
  staged: WorktreeChange[];
  unstaged: WorktreeChange[];
};

export type GitStashEntry = {
  index: number;
  name: string;
  branch: string | null;
  message: string;
};

export type GitOperationStatus = {
  projectId: string;
  worktreePath: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  changes: GitOperationChangeGroups;
  stashes: GitStashEntry[];
};

export type GitOperationResponse = {
  ok: true;
  status: GitOperationStatus;
};

export type WorktreeDiffResponse = {
  worktreePath: string;
  filePath: string;
  diff: string;
  truncated: boolean;
  lineCount: number;
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

export type ServiceProcessOwnership = "none" | "console" | "project" | "unknown";

export type ServiceSnapshot = RegisteredService & {
  status: "running" | "stopped" | "starting" | "error" | "port-occupied";
  startedByConsole: boolean;
  pid: number | null;
  processOwnership: ServiceProcessOwnership;
  processOwnerHint: string | null;
  portsStatus: ServicePortStatus[];
  logPreview: string[];
  error?: string;
};

export type ServiceGroupStatus = "running" | "partial" | "stopped" | "error";

export type ServiceGroupSnapshot = RegisteredServiceGroup & {
  services: ServiceSnapshot[];
  status: ServiceGroupStatus;
};

export type ServiceGroupAction = "start" | "stop" | "restart";

export type ServiceGroupActionOperation = "start" | "stop";

export type ServiceGroupActionResult = {
  serviceId: string;
  serviceName: string;
  operation: ServiceGroupActionOperation;
  ok: boolean;
  snapshot?: ServiceSnapshot;
  error?: string;
};

export type ServiceGroupActionResponse = {
  groupId: string;
  groupName: string;
  action: ServiceGroupAction;
  results: ServiceGroupActionResult[];
  errors: ServiceGroupActionResult[];
};

export type ProjectSnapshot = Omit<RegisteredProject, "services" | "serviceGroups"> & {
  exists: boolean;
  isGitRepository: boolean;
  status: "clean" | "dirty" | "missing" | "error";
  branch: BranchStatus | null;
  worktrees: WorktreeInfo[];
  branches: BranchInfo[];
  recentCommits: RecentCommit[];
  services: ServiceSnapshot[];
  serviceGroups?: ServiceGroupSnapshot[];
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

export type HealthIssueKind =
  | "missing-project"
  | "dirty-project"
  | "dirty-worktree"
  | "cleanup-candidate"
  | "stopped-service"
  | "occupied-port";

export type HealthIssueSeverity = "info" | "warning" | "critical";

export type HealthIssue = {
  id: string;
  kind: HealthIssueKind;
  severity: HealthIssueSeverity;
  title: string;
  detail: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  targetType?: "project" | "worktree" | "branch" | "service" | "port";
  target?: string;
  actionLabel?: string;
};

export type HealthSummary = {
  counts: {
    critical: number;
    warning: number;
    info: number;
    dirtyProjects: number;
    dirtyWorktrees: number;
    cleanupCandidates: number;
    stoppedServices: number;
    occupiedPorts: number;
    missingProjects: number;
  };
  issues: HealthIssue[];
};

export type DashboardResponse = {
  projects: ProjectSnapshot[];
  summary: DashboardSummary;
  health: HealthSummary;
};

export type ActivityTargetType = "project" | "worktree" | "branch" | "service" | "service-group" | "git";

export type ActivityEvent = {
  id: string;
  createdAt: string;
  action: string;
  label: string;
  status: "success" | "failed";
  projectId?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  targetType?: ActivityTargetType | null;
  target?: string | null;
  detail?: string | null;
};

export type ActivityResponse = {
  events: ActivityEvent[];
};
