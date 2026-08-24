import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  Activity,
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  History,
  LayoutDashboard,
  ListTree,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  WrapText
} from "lucide-react";

import {
  addProject,
  addService,
  addServiceGroup,
  deleteBranch,
  deleteWorktree,
  getActivity,
  getDashboard,
  getGitStatus,
  getProjectCommits,
  getServiceLogs,
  getWorktreeDiff,
  openProjectFolder,
  openProjectTerminal,
  removeProject,
  removeService,
  removeServiceGroup,
  restartServiceGroup,
  restartService,
  selectFolder,
  startServiceGroup,
  startService,
  stopServiceGroup,
  stopService,
  updateProjectName,
  runGitOperation
} from "./lib/api";
import {
  serviceCanRestart,
  serviceCanStop,
  serviceExternalStopConfirmation,
  serviceConfiguredPath,
  serviceKindLabel,
  serviceLaunchPath,
  servicePortLabel,
  servicePrimaryActionLabel,
  serviceShowProcessControls,
  serviceStatusLabel,
  serviceStatusTone,
  serviceUrl
} from "./lib/service-ui";
import {
  serviceGroupActionDisabled,
  serviceGroupActionLabel,
  serviceGroupStatusLabel,
  serviceGroupStatusTone
} from "./lib/service-groups-ui";
import { branchWorktreeAssociation } from "./lib/branch-ui";
import {
  groupHealthIssuesByProject,
  healthIssueLabel,
  healthIssueTone,
  healthMetricMatchesIssue,
  healthMetricTooltip,
  type HealthMetricFilter
} from "./lib/health-ui";
import {
  diffLineTone,
  focusedChangesInspectorWidth,
  worktreeChangesLayoutClass,
  worktreePanelLayoutClass
} from "./lib/diff-ui";
import {
  commitDisabledReason,
  gitPanelLayoutClass,
  gitSyncDisabledReason,
  shortGitActionLabel,
  type GitSyncAction
} from "./lib/git-ui";
import {
  AUTO_REFRESH_INTERVAL_MS,
  canStartAutoRefresh,
  finishRefreshRequest,
  isCurrentRefreshRequest,
  shouldBackOffAutoRefresh,
  startRefreshRequest,
  shouldShowRefreshLoading,
  shouldUseDashboardCache,
  type RefreshRequestTracker,
  type RefreshTrigger
} from "./lib/refresh-ui";
import type {
  ActivityEvent,
  BranchInfo,
  DashboardResponse,
  GitOperationStatus,
  HealthIssue,
  ProjectSnapshot,
  RecentCommit,
  RemovalAssessment,
  ServiceGroupAction,
  ServiceGroupActionResponse,
  ServiceGroupSnapshot,
  ServiceSnapshot,
  WorktreeChange,
  WorktreeDiffResponse,
  WorktreeInfo
} from "./shared/types";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { SegmentedControl, SegmentButton } from "./components/ui/tabs";

type StatusFilter = "all" | "clean" | "dirty" | "missing";
type SidebarView = "health" | "projects" | "worktrees" | "registry" | "activity";
type InspectorTab = "trees" | "branches" | "commits" | "services" | "git";
type CommitRange = "24h" | "7d" | "30d" | "all";

const emptyDashboard: DashboardResponse = {
  projects: [],
  summary: { projects: 0, worktrees: 0, services: 0, runningServices: 0, dirty: 0, missing: 0, clean: 0 },
  health: {
    counts: {
      critical: 0,
      warning: 0,
      info: 0,
      dirtyProjects: 0,
      dirtyWorktrees: 0,
      cleanupCandidates: 0,
      stoppedServices: 0,
      occupiedPorts: 0,
      missingProjects: 0
    },
    issues: []
  }
};

const SIDEBAR_COLUMN_WIDTH = 210;
const MIN_INSPECTOR_WIDTH = 340;

export function App() {
  const [dashboard, setDashboard] = useState<DashboardResponse>(emptyDashboard);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<SidebarView>("projects");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("trees");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [serviceDialogProject, setServiceDialogProject] = useState<ProjectSnapshot | null>(null);
  const [editProject, setEditProject] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(640);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const restoreInspectorWidth = useRef<number | null>(null);
  const restoreExpandedInspectorWidth = useRef<number | null>(null);
  const inspectorManuallyResized = useRef(false);
  const autoRefreshInFlight = useRef(false);
  const autoRefreshBackoff = useRef(false);
  const dashboardRefresh = useRef<RefreshRequestTracker>({ currentRequestId: 0, inFlight: false });
  const activityRefresh = useRef<RefreshRequestTracker>({ currentRequestId: 0, inFlight: false });

  const refresh = useCallback(async (trigger: RefreshTrigger = "manual") => {
    const requestId = startRefreshRequest(dashboardRefresh.current);
    const showLoading = shouldShowRefreshLoading(trigger);
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const nextDashboard = await getDashboard({ allowCache: shouldUseDashboardCache(trigger) });
      if (isCurrentRefreshRequest(dashboardRefresh.current, requestId)) {
        setDashboard(nextDashboard);
        setSelectedId((current) => current ?? nextDashboard.projects[0]?.id ?? null);
        return true;
      }
    } catch (caught) {
      if (isCurrentRefreshRequest(dashboardRefresh.current, requestId)) {
        setError((caught as Error).message);
      }
      return false;
    } finally {
      const finishedCurrentRequest = finishRefreshRequest(dashboardRefresh.current, requestId);
      if (showLoading && finishedCurrentRequest) {
        setLoading(false);
      }
    }
    return false;
  }, []);

  const refreshActivity = useCallback(async (trigger: RefreshTrigger = "manual") => {
    const requestId = startRefreshRequest(activityRefresh.current);
    const showLoading = shouldShowRefreshLoading(trigger);
    if (showLoading) {
      setActivityLoading(true);
    }
    setActivityError(null);
    try {
      const nextEvents = await getActivity(100);
      if (isCurrentRefreshRequest(activityRefresh.current, requestId)) {
        setActivityEvents(nextEvents);
        return true;
      }
    } catch (caught) {
      if (isCurrentRefreshRequest(activityRefresh.current, requestId)) {
        setActivityError((caught as Error).message);
      }
      return false;
    } finally {
      const finishedCurrentRequest = finishRefreshRequest(activityRefresh.current, requestId);
      if (showLoading && finishedCurrentRequest) {
        setActivityLoading(false);
      }
    }
    return false;
  }, []);

  async function refreshAfterOperation() {
    await refresh("operation");
    if (view === "activity") {
      await refreshActivity("operation");
    }
  }

  async function handleRefresh() {
    await refresh("manual");
    if (view === "activity") {
      await refreshActivity("manual");
    }
  }

  useEffect(() => {
    void refresh("initial");
  }, [refresh]);

  useEffect(() => {
    if (view === "activity") {
      void refreshActivity();
    }
  }, [refreshActivity, view]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const readyToRefresh = {
        autoCycleInFlight: autoRefreshInFlight.current,
        refreshInFlight: dashboardRefresh.current.inFlight,
        visibilityState: document.visibilityState
      };

      if (
        !canStartAutoRefresh({
          ...readyToRefresh,
          backoffPending: autoRefreshBackoff.current
        })
      ) {
        if (autoRefreshBackoff.current && canStartAutoRefresh(readyToRefresh)) {
          autoRefreshBackoff.current = false;
        }
        return;
      }

      const startedAt = performance.now();
      autoRefreshInFlight.current = true;
      void (async () => {
        try {
          await refresh("auto");
          if (view === "activity" && !activityRefresh.current.inFlight) {
            await refreshActivity("auto");
          }
        } finally {
          autoRefreshBackoff.current = shouldBackOffAutoRefresh(performance.now() - startedAt);
          autoRefreshInFlight.current = false;
        }
      })();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refresh, refreshActivity, view]);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return dashboard.projects.filter((project) => {
      const statusMatch =
        filter === "all" ||
        project.status === filter ||
        (filter === "missing" && project.status === "error");
      const tagMatch = !tagFilter || project.tags.includes(tagFilter);
      const queryMatch =
        !needle ||
        project.name.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle) ||
        project.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        project.branch?.branch.toLowerCase().includes(needle);
      return statusMatch && tagMatch && queryMatch;
    });
  }, [dashboard.projects, filter, query, tagFilter]);

  const availableTags = useMemo(
    () => Array.from(new Set(dashboard.projects.flatMap((project) => project.tags))).sort(),
    [dashboard.projects]
  );

  const selectedProject =
    dashboard.projects.find((project) => project.id === selectedId) ?? filteredProjects[0] ?? null;

  async function handleRemoveProject(project: ProjectSnapshot) {
    await removeProject(project.id);
    setNotice(`Removed ${project.name} from registry.`);
    setSelectedId(null);
    await refreshAfterOperation();
  }

  function handleViewChange(nextView: SidebarView) {
    setView(nextView);
    setTagFilter(null);
    if (nextView === "worktrees" || nextView === "activity" || nextView === "health") {
      setFilter("all");
    }
  }

  function handleInspectHealthIssue(issue: HealthIssue) {
    setQuery("");
    setFilter("all");
    setTagFilter(null);
    setSelectedId(issue.projectId);
    if (issue.kind === "stopped-service" || issue.kind === "occupied-port") {
      setInspectorTab("services");
    } else {
      setInspectorTab("trees");
    }
    setView("projects");
  }

  async function handleOpenFolder(project: ProjectSnapshot) {
    await openProjectFolder(project.id);
    setNotice(`Opening folder for ${project.name}.`);
  }

  async function handleOpenTerminal(project: ProjectSnapshot) {
    await openProjectTerminal(project.id);
    setNotice(`Opening terminal for ${project.name}.`);
  }

  async function handleCopyPath(project: ProjectSnapshot) {
    await navigator.clipboard.writeText(project.path);
    setNotice(`Copied path for ${project.name}.`);
  }

  const handleInspectorResizeStart = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    inspectorManuallyResized.current = true;
    restoreInspectorWidth.current = null;
    restoreExpandedInspectorWidth.current = null;
    setInspectorExpanded(false);
    startInspectorResize(event, setInspectorWidth);
  }, []);

  const handleChangesFocusChange = useCallback((focused: boolean) => {
    if (inspectorExpanded || inspectorManuallyResized.current || typeof window === "undefined") return;

    if (focused) {
      setInspectorWidth((currentWidth) => {
        restoreInspectorWidth.current ??= currentWidth;
        return focusedChangesInspectorWidth({
          currentWidth,
          viewportWidth: window.innerWidth
        });
      });
      return;
    }

    setInspectorWidth((currentWidth) => {
      const nextWidth = restoreInspectorWidth.current ?? currentWidth;
      restoreInspectorWidth.current = null;
      return nextWidth;
    });
  }, [inspectorExpanded]);

  const handleToggleInspectorExpanded = useCallback(() => {
    if (typeof window === "undefined") return;

    if (inspectorExpanded) {
      const restoredWidth = restoreExpandedInspectorWidth.current;
      restoreExpandedInspectorWidth.current = null;
      inspectorManuallyResized.current = true;
      setInspectorExpanded(false);
      if (restoredWidth !== null) {
        setInspectorWidth(restoredWidth);
      }
      return;
    }

    setInspectorWidth((currentWidth) => {
      restoreExpandedInspectorWidth.current = restoreInspectorWidth.current ?? currentWidth;
      restoreInspectorWidth.current = null;
      return Math.max(MIN_INSPECTOR_WIDTH, window.innerWidth - SIDEBAR_COLUMN_WIDTH);
    });
    inspectorManuallyResized.current = false;
    setInspectorExpanded(true);
  }, [inspectorExpanded]);

  return (
    <div className="window-shell">
      <header className="trafficbar">
        <div className="traffic" aria-hidden="true">
          <span className="traffic-dot red" />
          <span className="traffic-dot yellow" />
          <span className="traffic-dot green" />
        </div>
        <div className="toolbar-title">
          <GitBranch size={16} />
          Worktree Console
        </div>
        <div className="toolbar-actions">
          <Button aria-label="Refresh" disabled={loading || activityLoading} size="icon" onClick={() => void handleRefresh()}>
            <RefreshCw size={15} />
          </Button>
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Plus size={15} />
            Add Project
          </Button>
        </div>
      </header>

      <div
        className="app-body"
        style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
      >
        <Sidebar
          availableTags={availableTags}
          tagFilter={tagFilter}
          view={view}
          onAddProject={() => setDialogOpen(true)}
          onSelectTag={setTagFilter}
          onViewChange={handleViewChange}
        />

        <main className="content">
          <div className="hero-row">
            <div>
              <h1>{viewTitle(view, tagFilter)}</h1>
              <div className="subtitle">{viewSubtitle(view)}</div>
            </div>
            {view === "activity" ? (
              <Button disabled={activityLoading} onClick={() => void refreshActivity()}>
                <RefreshCw size={15} />
                Refresh Log
              </Button>
            ) : selectedProject ? (
              <Button onClick={() => void handleOpenFolder(selectedProject)}>
                <FolderOpen size={15} />
                Open Folder
              </Button>
            ) : null}
          </div>

          {view !== "activity" && view !== "health" ? (
            <div className="toolbar-row">
              <label className="search-field">
                <Search size={15} />
                <Input
                  aria-label="Search projects"
                  placeholder="Search project, branch, path"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <SegmentedControl>
                {(["all", "clean", "dirty", "missing"] as const).map((status) => (
                  <SegmentButton key={status} active={filter === status} onClick={() => setFilter(status)}>
                    {labelStatus(status)}
                  </SegmentButton>
                ))}
              </SegmentedControl>
            </div>
          ) : null}

          {error ? <div className="error-banner">{error}</div> : null}
          {notice ? (
            <div className="notice-banner">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)}>Dismiss</button>
            </div>
          ) : null}

          {view === "activity" ? (
            <ActivityPanel
              error={activityError}
              events={activityEvents}
              loading={activityLoading}
              onRefresh={() => void refreshActivity()}
            />
          ) : view === "health" ? (
            <HealthPanel
              dashboard={dashboard}
              loading={loading}
              onInspectIssue={handleInspectHealthIssue}
            />
          ) : (
            <>
              <StatusStrip dashboard={dashboard} />

              <section className="stats" aria-label="Summary">
                <Metric label="Projects" value={dashboard.summary.projects} />
                <Metric label="Worktrees" value={dashboard.summary.worktrees} />
                <Metric label="Services" value={dashboard.summary.services} />
                <Metric label="Running" value={dashboard.summary.runningServices} />
                <Metric label="Dirty" value={dashboard.summary.dirty} />
                <Metric label="Missing" value={dashboard.summary.missing} />
              </section>

              <ProjectList
                loading={loading}
                projects={filteredProjects}
                registryMode={view === "registry"}
                selectedId={selectedProject?.id ?? null}
                onCopyPath={(project) => void handleCopyPath(project)}
                onOpenFolder={(project) => void handleOpenFolder(project)}
                onOpenTerminal={(project) => void handleOpenTerminal(project)}
                onRemoveProject={(project) => void handleRemoveProject(project)}
                onSelectProject={(project) => setSelectedId(project.id)}
              />
            </>
          )}
        </main>

        <Inspector
          expanded={inspectorExpanded}
          project={selectedProject}
          tab={inspectorTab}
          onAddService={(project) => setServiceDialogProject(project)}
          onEditProject={(project) => setEditProject(project)}
          onDeleteBranch={(project, branch) => {
            setConfirmAction({
              type: "branch",
              title: `Delete branch ${branch.name}?`,
              description: branch.removal.reasons.join(" "),
              project,
              branch
            });
          }}
          onDeleteWorktree={(project, worktree) => {
            setConfirmAction({
              type: "worktree",
              title: `Remove worktree ${worktree.branch ?? worktree.shortHead ?? "detached"}?`,
              description: worktree.removal?.reasons.join(" ") ?? "This worktree is marked safe to remove.",
              project,
              worktree
            });
          }}
          onDeleteService={(project, service) => {
            setConfirmAction({
              type: "service",
              title: `Remove service ${service.name}?`,
              description: "This only removes the service registration from this console. It does not stop a running process.",
              project,
              service
            });
          }}
          onChangesFocusChange={handleChangesFocusChange}
          onResizeStart={handleInspectorResizeStart}
          onServiceChanged={async (message) => {
            setNotice(message);
            await refreshAfterOperation();
          }}
          onGitChanged={async (message) => {
            setNotice(message);
            await refreshAfterOperation();
          }}
          onTabChange={setInspectorTab}
          onToggleExpanded={handleToggleInspectorExpanded}
        />
      </div>

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={async () => {
          setDialogOpen(false);
          await refreshAfterOperation();
        }}
      />
      <AddServiceDialog
        project={serviceDialogProject}
        onOpenChange={(open) => {
          if (!open) setServiceDialogProject(null);
        }}
        onAdded={async () => {
          setServiceDialogProject(null);
          setNotice("Service registered.");
          await refreshAfterOperation();
        }}
      />
      <EditProjectDialog
        project={editProject}
        onOpenChange={(open) => {
          if (!open) setEditProject(null);
        }}
        onSaved={async (projectName) => {
          setEditProject(null);
          setNotice(`Renamed project to ${projectName}.`);
          await refreshAfterOperation();
        }}
      />
      <ConfirmDeleteDialog
        action={confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!confirmAction) return;
          if (confirmAction.type === "worktree") {
            await deleteWorktree(confirmAction.project.id, confirmAction.worktree.path);
            setNotice(`Removed worktree ${confirmAction.worktree.path}.`);
          } else {
            if (confirmAction.type === "branch") {
              await deleteBranch(confirmAction.project.id, confirmAction.branch.name);
              setNotice(`Deleted branch ${confirmAction.branch.name}.`);
            } else {
              await removeService(confirmAction.project.id, confirmAction.service.id);
              setNotice(`Removed service ${confirmAction.service.name}.`);
            }
          }
          setConfirmAction(null);
          await refreshAfterOperation();
        }}
      />
    </div>
  );
}

type ConfirmAction =
  | {
      type: "worktree";
      title: string;
      description: string;
      project: ProjectSnapshot;
      worktree: WorktreeInfo;
    }
  | {
      type: "branch";
      title: string;
      description: string;
      project: ProjectSnapshot;
      branch: BranchInfo;
    }
  | {
      type: "service";
      title: string;
      description: string;
      project: ProjectSnapshot;
      service: ServiceSnapshot;
    };

function Sidebar({
  availableTags,
  onAddProject,
  onSelectTag,
  onViewChange,
  tagFilter,
  view
}: {
  availableTags: string[];
  onAddProject: () => void;
  onSelectTag: (tag: string | null) => void;
  onViewChange: (view: SidebarView) => void;
  tagFilter: string | null;
  view: SidebarView;
}) {
  return (
    <aside className="sidebar">
      <p className="side-label">Library</p>
      <button className={`source ${view === "health" ? "active" : ""}`} onClick={() => onViewChange("health")}>
        <Activity size={15} />
        Health
      </button>
      <button className={`source ${view === "projects" ? "active" : ""}`} onClick={() => onViewChange("projects")}>
        <LayoutDashboard size={15} />
        All Projects
      </button>
      <button className={`source ${view === "worktrees" ? "active" : ""}`} onClick={() => onViewChange("worktrees")}>
        <ListTree size={15} />
        Worktrees
      </button>
      <button className={`source ${view === "registry" ? "active" : ""}`} onClick={() => onViewChange("registry")}>
        <Settings size={15} />
        Registry
      </button>
      <button className={`source ${view === "activity" ? "active" : ""}`} onClick={() => onViewChange("activity")}>
        <History size={15} />
        Activity
      </button>

      <p className="side-label">Tags</p>
      {availableTags.length === 0 ? (
        <button className="source muted" onClick={onAddProject}>
          Add tags with a project
        </button>
      ) : (
        <>
          <button className={`source ${tagFilter === null ? "active-subtle" : ""}`} onClick={() => onSelectTag(null)}>
            All Tags
          </button>
          {availableTags.map((tag) => (
            <button
              className={`source ${tagFilter === tag ? "active-subtle" : ""}`}
              key={tag}
              onClick={() => onSelectTag(tag)}
            >
              {tag}
            </button>
          ))}
        </>
      )}
    </aside>
  );
}

function StatusStrip({ dashboard }: { dashboard: DashboardResponse }) {
  const needsAttention = dashboard.summary.dirty > 0 || dashboard.summary.missing > 0;

  return (
    <section className="status-strip" aria-label="Git status summary">
      <div className="status-message">
        <span className={needsAttention ? "pulse" : "pulse clean"} aria-hidden="true" />
        <span>{needsAttention ? "Attention needed in registered projects" : "Registered projects are clean"}</span>
      </div>
      <div className="status-chips">
        <Badge tone="dirty">{dashboard.summary.dirty} Dirty</Badge>
        <Badge tone="error">{dashboard.summary.missing} Missing</Badge>
        <Badge tone="clean">{dashboard.summary.clean} Clean</Badge>
        <Badge>{dashboard.summary.worktrees} Worktrees</Badge>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ActivityPanel({
  error,
  events,
  loading,
  onRefresh
}: {
  error: string | null;
  events: ActivityEvent[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="activity-panel" aria-label="Activity log">
      <div className="activity-heading">
        <div>
          <h3>Recent Activity</h3>
          <p>Console actions recorded on this machine.</p>
        </div>
        <Button disabled={loading} onClick={onRefresh}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      {error ? <div className="error-banner compact">{error}</div> : null}
      {loading ? (
        <div className="empty-state compact">Loading activity...</div>
      ) : events.length === 0 ? (
        <div className="empty-state compact">No console actions have been recorded yet.</div>
      ) : (
        <div className="activity-list">
          {events.map((event) => (
            <article className="activity-row" key={event.id}>
              <span className={`activity-dot ${event.status}`} aria-hidden="true" />
              <div className="activity-main">
                <div className="activity-title">
                  <strong>{event.label}</strong>
                  <Badge tone={event.status === "failed" ? "error" : "clean"}>
                    {activityActionLabel(event.action)}
                  </Badge>
                </div>
                <div className="activity-meta">
                  <span>{event.projectName ?? "Unknown project"}</span>
                  {event.target ? (
                    <>
                      <span aria-hidden="true">/</span>
                      <span>{activityTargetLabel(event.targetType)}: {event.target}</span>
                    </>
                  ) : null}
                </div>
                {event.detail ? <div className="activity-detail mono">{event.detail}</div> : null}
              </div>
              <time className="activity-time" dateTime={event.createdAt} title={formatActivityFullTime(event.createdAt)}>
                {formatActivityTime(event.createdAt)}
              </time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HealthPanel({
  dashboard,
  loading,
  onInspectIssue
}: {
  dashboard: DashboardResponse;
  loading: boolean;
  onInspectIssue: (issue: HealthIssue) => void;
}) {
  const { counts, issues } = dashboard.health;
  const [metricFilter, setMetricFilter] = useState<HealthMetricFilter | null>(null);
  const filteredIssues = metricFilter
    ? issues.filter((issue) => healthMetricMatchesIssue(metricFilter, issue))
    : issues;
  const issueGroups = groupHealthIssuesByProject(filteredIssues);
  const metrics: Array<{ filter: HealthMetricFilter; label: string; value: number }> = [
    { filter: "critical", label: "Critical", value: counts.critical },
    { filter: "warning", label: "Warnings", value: counts.warning },
    { filter: "cleanup", label: "Cleanup", value: counts.cleanupCandidates },
    { filter: "stopped", label: "Stopped", value: counts.stoppedServices }
  ];

  return (
    <section className="health-panel" aria-label="Project health">
      <section className="health-metrics" aria-label="Health summary">
        {metrics.map((metric) => (
          <HealthMetric
            active={metricFilter === metric.filter}
            filter={metric.filter}
            key={metric.filter}
            label={metric.label}
            onClick={() => setMetricFilter((current) => (current === metric.filter ? null : metric.filter))}
            value={metric.value}
          />
        ))}
      </section>

      {loading ? (
        <div className="empty-state compact">Refreshing project health...</div>
      ) : issues.length === 0 ? (
        <div className="empty-state compact">All registered projects look healthy.</div>
      ) : filteredIssues.length === 0 ? (
        <div className="empty-state compact">
          No {metricFilter ? healthMetricEmptyLabel(metricFilter) : "matching"} issues right now.
        </div>
      ) : (
        <div className="health-project-groups">
          {metricFilter ? (
            <div className="health-filter-note">
              Showing {healthMetricFilterLabel(metricFilter)}. Click the card again to show all.
            </div>
          ) : null}
          {issueGroups.map((group) => (
            <section className="health-project-group" key={group.projectId}>
              <div className="health-project-heading">
                <div>
                  <h3>{group.projectName}</h3>
                  <p className="mono">{group.projectPath}</p>
                </div>
                <Badge tone={group.issues.some((issue) => issue.severity === "critical") ? "error" : "dirty"}>
                  {group.issues.length} issue{group.issues.length === 1 ? "" : "s"}
                </Badge>
              </div>
              <div className="health-list">
                {group.issues.map((issue) => (
                  <HealthIssueRow
                    dashboard={dashboard}
                    issue={issue}
                    key={issue.id}
                    onInspectIssue={onInspectIssue}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function HealthMetric({
  active,
  filter,
  label,
  onClick,
  value
}: {
  active: boolean;
  filter: HealthMetricFilter;
  label: string;
  onClick: () => void;
  value: number;
}) {
  return (
    <button
      aria-pressed={active}
      className={`stat health-stat explainable ${active ? "active" : ""}`}
      data-tooltip={healthMetricTooltip(filter)}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function healthMetricFilterLabel(filter: HealthMetricFilter) {
  if (filter === "critical") return "critical issues";
  if (filter === "warning") return "warnings";
  if (filter === "cleanup") return "cleanup candidates";
  return "stopped services";
}

function healthMetricEmptyLabel(filter: HealthMetricFilter) {
  if (filter === "critical") return "critical";
  if (filter === "warning") return "warning";
  if (filter === "cleanup") return "cleanup";
  return "stopped service";
}

function HealthIssueRow({
  dashboard,
  issue,
  onInspectIssue
}: {
  dashboard: DashboardResponse;
  issue: HealthIssue;
  onInspectIssue: (issue: HealthIssue) => void;
}) {
  return (
    <article className="health-row">
      <div className="health-main">
        <div className="health-title">
          <strong>{issue.title}</strong>
          <Badge tone={healthIssueTone(issue.severity)}>{healthIssueLabel(issue.kind)}</Badge>
        </div>
        <div className="health-meta">
          <span>{healthTargetLabel(issue, dashboard.projects)}</span>
        </div>
        <div className="health-detail">{issue.detail}</div>
      </div>
      <div className="health-actions">
        <Badge tone={healthIssueTone(issue.severity)}>{severityLabel(issue.severity)}</Badge>
        <Button onClick={() => onInspectIssue(issue)}>{issue.actionLabel ?? "Inspect"}</Button>
      </div>
    </article>
  );
}

function ProjectList({
  loading,
  onCopyPath,
  onOpenFolder,
  onOpenTerminal,
  onRemoveProject,
  onSelectProject,
  projects,
  registryMode,
  selectedId
}: {
  loading: boolean;
  projects: ProjectSnapshot[];
  registryMode: boolean;
  selectedId: string | null;
  onCopyPath: (project: ProjectSnapshot) => void;
  onOpenFolder: (project: ProjectSnapshot) => void;
  onOpenTerminal: (project: ProjectSnapshot) => void;
  onRemoveProject: (project: ProjectSnapshot) => void;
  onSelectProject: (project: ProjectSnapshot) => void;
}) {
  if (loading) {
    return <div className="empty-state">Refreshing registered projects...</div>;
  }

  if (projects.length === 0) {
    return <div className="empty-state">No projects match this view. Add a project or adjust filters.</div>;
  }

  return (
    <section className="project-list" aria-label="Projects">
      <div className="project-row header">
        <div>Project</div>
        <div>Branch</div>
        <div>Tree</div>
        <div>Status</div>
        <div>Updated</div>
        <div>{registryMode ? "Manage" : "Actions"}</div>
      </div>
      {projects.map((project) => (
        <div
          className={`project-row ${selectedId === project.id ? "selected" : ""}`}
          key={project.id}
          onClick={() => onSelectProject(project)}
        >
          <div className="repo">
            <span className={`status-dot ${project.status}`} />
            <span className="repo-text">
              <strong>{project.name}</strong>
              <span className="mono">{project.path}</span>
            </span>
          </div>
          <span className="mono">{project.branch?.branch ?? "unknown"}</span>
          <span>{project.worktrees.length}</span>
          <Badge tone={badgeTone(project.status)}>{labelStatus(project.status)}</Badge>
          <span>{project.recentCommits[0]?.relativeTime ?? "n/a"}</span>
          <span className="row-actions">
            <Button aria-label="Copy path" size="icon" title="Copy path" variant="ghost" onClick={(event) => action(event, () => onCopyPath(project))}>
              <Copy size={15} />
            </Button>
            <Button aria-label="Open folder" size="icon" title="Open folder" variant="ghost" onClick={(event) => action(event, () => onOpenFolder(project))}>
              <FolderOpen size={15} />
            </Button>
            <Button aria-label="Open terminal" size="icon" title="Open terminal" variant="ghost" onClick={(event) => action(event, () => onOpenTerminal(project))}>
              <Terminal size={15} />
            </Button>
            {registryMode ? (
              <Button aria-label="Remove project" size="icon" title="Remove project" variant="ghost" onClick={(event) => action(event, () => onRemoveProject(project))}>
                <Trash2 size={15} />
              </Button>
            ) : null}
          </span>
        </div>
      ))}
    </section>
  );
}

function Inspector({
  expanded,
  onAddService,
  onDeleteBranch,
  onDeleteService,
  onDeleteWorktree,
  onEditProject,
  onChangesFocusChange,
  onResizeStart,
  onGitChanged,
  onServiceChanged,
  onTabChange,
  onToggleExpanded,
  project,
  tab
}: {
  expanded: boolean;
  project: ProjectSnapshot | null;
  tab: InspectorTab;
  onAddService: (project: ProjectSnapshot) => void;
  onDeleteBranch: (project: ProjectSnapshot, branch: BranchInfo) => void;
  onDeleteService: (project: ProjectSnapshot, service: ServiceSnapshot) => void;
  onDeleteWorktree: (project: ProjectSnapshot, worktree: WorktreeInfo) => void;
  onEditProject: (project: ProjectSnapshot) => void;
  onChangesFocusChange: (focused: boolean) => void;
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
  onGitChanged: (message: string) => Promise<void>;
  onServiceChanged: (message: string) => Promise<void>;
  onTabChange: (tab: InspectorTab) => void;
  onToggleExpanded: () => void;
}) {
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedWorktreePath(null);
  }, [project?.id]);

  useEffect(() => {
    onChangesFocusChange((tab === "trees" && Boolean(selectedWorktreePath)) || tab === "git");
  }, [onChangesFocusChange, selectedWorktreePath, tab]);

  if (!project) {
    return (
      <aside className="inspector">
        <button
          aria-label="Resize inspector"
          className="inspector-resizer"
          onPointerDown={onResizeStart}
          type="button"
        />
        <div className="empty-state compact">Select a project to inspect worktrees and recent commits.</div>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <button
        aria-label="Resize inspector"
        className="inspector-resizer"
        onPointerDown={onResizeStart}
        type="button"
      />
      <div className="inspector-title">
        <div>
          <div className="inspector-name-row">
            <h2>{project.name}</h2>
            <Button
              aria-label="Edit project display name"
              size="icon"
              title="Edit project display name"
              variant="ghost"
              onClick={() => onEditProject(project)}
            >
              <Pencil size={14} />
            </Button>
            <Button
              aria-label={expanded ? "Restore project details width" : "Expand project details"}
              size="icon"
              title={expanded ? "Restore project details width" : "Expand project details"}
              variant="ghost"
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
          </div>
          <p className="mono">{project.path}</p>
        </div>
        <Badge tone={badgeTone(project.status)}>{labelStatus(project.status)}</Badge>
      </div>

      <SegmentedControl>
        <SegmentButton active={tab === "trees"} onClick={() => onTabChange("trees")}>
          Trees
        </SegmentButton>
        <SegmentButton active={tab === "branches"} onClick={() => onTabChange("branches")}>
          Branches
        </SegmentButton>
        <SegmentButton active={tab === "commits"} onClick={() => onTabChange("commits")}>
          Commits
        </SegmentButton>
        <SegmentButton active={tab === "services"} onClick={() => onTabChange("services")}>
          Services
        </SegmentButton>
        <SegmentButton active={tab === "git"} onClick={() => onTabChange("git")}>
          Git
        </SegmentButton>
      </SegmentedControl>

      {project.error ? <div className="error-banner compact">{project.error}</div> : null}

      {tab === "trees" ? (
        <WorktreePanel
          project={project}
          selectedPath={selectedWorktreePath}
          onDeleteWorktree={onDeleteWorktree}
          onSelectedPathChange={setSelectedWorktreePath}
        />
      ) : null}
      {tab === "branches" ? (
        <BranchPanel
          project={project}
          onDeleteBranch={onDeleteBranch}
          onViewWorktree={(worktree) => {
            setSelectedWorktreePath(worktree.path);
            onTabChange("trees");
          }}
        />
      ) : null}
      {tab === "commits" ? <CommitPanel project={project} /> : null}
      {tab === "services" ? (
        <ServicePanel
          project={project}
          onAddService={onAddService}
          onDeleteService={onDeleteService}
          onServiceChanged={onServiceChanged}
        />
      ) : null}
      {tab === "git" ? <GitPanel project={project} onGitChanged={onGitChanged} /> : null}
    </aside>
  );
}

function WorktreePanel({
  onDeleteWorktree,
  onSelectedPathChange,
  selectedPath,
  project
}: {
  project: ProjectSnapshot;
  selectedPath: string | null;
  onDeleteWorktree: (project: ProjectSnapshot, worktree: WorktreeInfo) => void;
  onSelectedPathChange: (path: string | null) => void;
}) {
  const selectedWorktree =
    project.worktrees.find((worktree) => worktree.path === selectedPath) ?? null;

  return (
    <section className={worktreePanelLayoutClass(Boolean(selectedWorktree))}>
      {selectedWorktree ? (
        <WorktreeChanges projectId={project.id} onClose={() => onSelectedPathChange(null)} worktree={selectedWorktree} />
      ) : (
        <div className="worktree-list-pane">
          <h3>Worktrees</h3>
          <div className="tree">
            {project.worktrees.length === 0 ? (
              <div className="empty-state compact">No worktrees found.</div>
            ) : (
              project.worktrees.map((worktree) => (
                <div
                  className="tree-item tree-button"
                  key={`${worktree.path}-${worktree.head}`}
                  onClick={(event) => {
                    if (hasTextSelectionInside(event.currentTarget)) {
                      return;
                    }
                    onSelectedPathChange(worktree.path);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectedPathChange(worktree.path);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="tree-top">
                    <strong>{worktree.branch ?? "detached"}</strong>
                    <span className="tree-badges">
                      <ExplainableBadge align="right" tone={worktree.clean ? "clean" : "dirty"} tooltip={worktreeChangeTooltip(worktree)}>
                        {worktree.clean ? "Clean" : `${worktree.dirtyFiles ?? 0} changed`}
                      </ExplainableBadge>
                      <ExplainableBadge align="right" tone={removalTone(worktree.removal?.level)} tooltip={removalTooltip(worktree.removal)}>
                        {worktree.removal?.label ?? "Unknown"}
                      </ExplainableBadge>
                      <ExplainableBadge align="right" tooltip={worktreeKindTooltip(worktree)}>
                        {worktree.detached ? "Detached" : "Branch"}
                      </ExplainableBadge>
                    </span>
                  </div>
                  <ExplainableText className="worktree-origin" tooltip={worktreeOriginTooltip(worktree)}>
                    {worktreeOriginLabel(worktree)}
                  </ExplainableText>
                  <span className="mono">{worktree.path}</span>
                  {worktree.removal?.canDelete ? (
                    <span className="tree-actions">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove safe worktree"
                        title="Remove safe worktree"
                        onClick={(event) => action(event, () => onDeleteWorktree(project, worktree))}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function WorktreeChanges({
  onClose,
  projectId,
  worktree
}: {
  onClose: () => void;
  projectId: string;
  worktree: NonNullable<ProjectSnapshot["worktrees"][number]>;
}) {
  const changes = worktree.changes ?? [];
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<WorktreeDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const diffRequestId = useRef(0);
  const copyRequestId = useRef(0);
  const copyFeedbackTimer = useRef<number | null>(null);
  const changePathsKey = changes.map((change) => change.path).join("\u0000");

  useEffect(() => {
    resetDiffState();

    return () => {
      diffRequestId.current += 1;
      copyRequestId.current += 1;
      clearCopyFeedbackTimer();
    };
  }, [projectId, worktree.path]);

  useEffect(() => {
    if (!selectedFile || changes.some((change) => change.path === selectedFile)) return;
    resetDiffState();
  }, [changePathsKey, selectedFile]);

  function clearCopyFeedbackTimer() {
    if (copyFeedbackTimer.current === null) return;
    window.clearTimeout(copyFeedbackTimer.current);
    copyFeedbackTimer.current = null;
  }

  function resetDiffState() {
    diffRequestId.current += 1;
    copyRequestId.current += 1;
    clearCopyFeedbackTimer();
    setSelectedFile(null);
    setDiff(null);
    setDiffLoading(false);
    setDiffError(null);
    setCopiedPath(null);
    setCopyError(null);
  }

  async function loadDiff(filePath: string) {
    const requestId = diffRequestId.current + 1;
    diffRequestId.current = requestId;
    copyRequestId.current += 1;
    clearCopyFeedbackTimer();
    setSelectedFile(filePath);
    setDiff(null);
    setDiffLoading(true);
    setDiffError(null);
    setCopiedPath(null);
    setCopyError(null);

    try {
      const nextDiff = await getWorktreeDiff(projectId, worktree.path, filePath);
      if (diffRequestId.current !== requestId) return;
      setDiff(nextDiff);
    } catch (caught) {
      if (diffRequestId.current !== requestId) return;
      setDiffError((caught as Error).message);
    } finally {
      if (diffRequestId.current === requestId) {
        setDiffLoading(false);
      }
    }
  }

  async function copySelectedPath() {
    if (!selectedFile) return;

    const filePath = selectedFile;
    const requestId = copyRequestId.current + 1;
    copyRequestId.current = requestId;
    clearCopyFeedbackTimer();
    setCopiedPath(null);
    setCopyError(null);

    if (!navigator.clipboard?.writeText) {
      setCopyError("Clipboard is unavailable in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(filePath);
      if (copyRequestId.current !== requestId) return;
      setCopiedPath(filePath);
      copyFeedbackTimer.current = window.setTimeout(() => {
        if (copyRequestId.current !== requestId) return;
        setCopiedPath((current) => (current === filePath ? null : current));
        copyFeedbackTimer.current = null;
      }, 1600);
    } catch (caught) {
      if (copyRequestId.current !== requestId) return;
      setCopyError((caught as Error).message || "Could not copy path.");
    }
  }

  function copyStatusLabel() {
    if (copyError) return copyError;
    if (diff?.truncated) return `Showing a bounded preview of ${diff.lineCount} diff lines.`;
    return null;
  }

  const copyStatus = copyStatusLabel();

  return (
    <section className={worktreeChangesLayoutClass(changes.length)}>
      <div className="detail-heading">
        <div>
          <button className="back-to-worktrees" onClick={onClose} type="button">
            <ArrowLeft size={13} />
            Worktrees
          </button>
          <h3>Changes</h3>
          <p className="mono">{worktreeOriginLabel(worktree)}</p>
        </div>
        <span className="detail-actions">
          <Badge tone={changes.length === 0 ? "clean" : "dirty"}>{changes.length === 0 ? "Clean" : `${changes.length} files`}</Badge>
          <button aria-label="Close changes" className="close-changes" onClick={onClose} type="button">
            ×
          </button>
        </span>
      </div>
      {changes.length === 0 ? (
        <div className="empty-state compact">No local changes in this worktree.</div>
      ) : (
        <div className="changes-layout">
          <div className="change-list-pane">
            <div className="change-list">
              {changes.map((change) => (
                <button
                  className={`change-row ${selectedFile === change.path ? "selected" : ""}`}
                  key={`${change.code}-${change.path}`}
                  onClick={() => void loadDiff(change.path)}
                  type="button"
                >
                  <span className={`change-code ${changeTone(change.code)}`}>{change.code}</span>
                  <span className="mono">{change.path}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="diff-pane">
            <div className="diff-section" aria-live="polite">
              {selectedFile ? (
                <div className="diff-heading">
                  <div className="diff-file">
                    <strong>{selectedFile}</strong>
                    {copyStatus ? (
                      <span className={`diff-note ${copyError ? "error" : ""}`}>{copyStatus}</span>
                    ) : null}
                  </div>
                  <span className="detail-actions">
                    {diff?.truncated ? <Badge tone="dirty">Truncated</Badge> : null}
                    <Button title="Copy selected file path" onClick={() => void copySelectedPath()}>
                      <Copy size={13} />
                      {copiedPath === selectedFile ? "Copied" : "Copy path"}
                    </Button>
                  </span>
                </div>
              ) : null}
              {diffLoading ? (
                <div className="empty-state compact">Loading diff...</div>
              ) : diffError ? (
                <div className="error-banner compact">{diffError}</div>
              ) : diff ? (
                <DiffPreview diff={diff} />
              ) : (
                <div className="empty-state compact">Select a changed file to preview its diff.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DiffPreview({ diff }: { diff: WorktreeDiffResponse }) {
  const [wrapLines, setWrapLines] = useState(false);

  if (diff.diff.trim().length === 0) {
    return <div className="empty-state compact">No text diff available for this file.</div>;
  }

  return (
    <div className="diff-preview-shell">
      <div className="diff-preview-toolbar">
        <Button
          aria-pressed={wrapLines}
          size="icon"
          title={wrapLines ? "Disable diff line wrapping" : "Wrap diff lines"}
          variant={wrapLines ? "primary" : "ghost"}
          aria-label={wrapLines ? "Disable diff line wrapping" : "Wrap diff lines"}
          onClick={() => setWrapLines((current) => !current)}
        >
          <WrapText size={14} />
        </Button>
      </div>
      <pre className={`diff-preview ${wrapLines ? "wrap-lines" : ""}`} aria-label={`Diff preview for ${diff.filePath}`}>
        {diff.diff.split(/\r?\n/).map((line, index) => (
          <span className={`diff-line ${diffLineTone(line)}`} key={index}>
            {line.length === 0 ? " " : line}
          </span>
        ))}
      </pre>
    </div>
  );
}

function BranchPanel({
  onDeleteBranch,
  onViewWorktree,
  project
}: {
  project: ProjectSnapshot;
  onDeleteBranch: (project: ProjectSnapshot, branch: BranchInfo) => void;
  onViewWorktree: (worktree: WorktreeInfo) => void;
}) {
  return (
    <section className="section">
      <h3>Branches</h3>
      <div className="branch-list">
        {project.branches.length === 0 ? (
          <div className="empty-state compact">No branches available.</div>
        ) : (
          project.branches.map((branch) => {
            const trackingLabel = branchTrackingLabel(branch);
            const association = branchWorktreeAssociation(branch, project.worktrees);

            return (
              <div className="branch-row" key={branch.name}>
                <div className="branch-main">
                  <strong>{branch.name}</strong>
                  <ExplainableText className="branch-meta" tooltip={branchMetaTooltip(branch)}>
                    {branchMetaLabel(branch)}
                  </ExplainableText>
                  {trackingLabel ? (
                    <ExplainableText className="branch-meta branch-tracking" tooltip={branchTrackingTooltip(branch)}>
                      {trackingLabel}
                    </ExplainableText>
                  ) : null}
                  {association ? (
                    <div className="branch-worktree">
                      <ExplainableText className="branch-worktree-path mono" tooltip={association.tooltip}>
                        {association.worktree.path}
                      </ExplainableText>
                      <ExplainableBadge
                        tone={association.worktree.clean ? "clean" : "dirty"}
                        tooltip={association.tooltip}
                      >
                        {association.changeLabel}
                      </ExplainableBadge>
                      <Button
                        title="Open linked worktree changes"
                        onClick={() => onViewWorktree(association.worktree)}
                      >
                        <ListTree size={13} />
                        View changes
                      </Button>
                    </div>
                  ) : null}
                </div>
                <span className="branch-actions">
                  <ExplainableBadge align="right" tone={removalTone(branch.removal.level)} tooltip={removalTooltip(branch.removal)}>
                    {branch.removal.label}
                  </ExplainableBadge>
                  {branch.removal.canDelete ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete branch ${branch.name}`}
                      title={`Delete branch ${branch.name}`}
                      onClick={() => onDeleteBranch(project, branch)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function gitTargetOptions(project: ProjectSnapshot) {
  return [
    {
      label: `Main checkout${project.branch?.branch ? ` - ${project.branch.branch}` : ""}`,
      path: project.path
    },
    ...project.worktrees
      .filter((worktree) => !sameGitPath(worktree.path, project.path))
      .map((worktree) => ({
        label: `${worktree.branch ?? "detached"} - ${worktree.path}`,
        path: worktree.path
      }))
  ];
}

function gitTargetSummary(project: ProjectSnapshot, targetPath: string) {
  if (sameGitPath(project.path, targetPath)) {
    return project.branch?.branch ? `main checkout - ${project.branch.branch}` : "main checkout";
  }
  const worktree = project.worktrees.find((candidate) => sameGitPath(candidate.path, targetPath));
  if (!worktree) return targetPath;
  return worktree.branch ? `worktree - ${worktree.branch}` : "worktree - detached";
}

function uniqueGitChanges(changes: WorktreeChange[]) {
  const seen = new Set<string>();
  return changes.filter((change) => {
    if (seen.has(change.path)) return false;
    seen.add(change.path);
    return true;
  });
}

type GitTargetOption = ReturnType<typeof gitTargetOptions>[number];

function GitTargetPicker({
  className = "",
  label,
  onChange,
  options,
  value
}: {
  className?: string;
  label: string;
  onChange: (path: string) => void;
  options: GitTargetOption[];
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => sameGitPath(option.path, value)) ?? options[0];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) =>
            `${option.label} ${option.path}`.toLowerCase().includes(normalizedQuery)
          )
        : options,
    [normalizedQuery, options]
  );

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
      setQuery("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => searchRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectOption(path: string) {
    onChange(path);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={`target-select searchable-target-select ${className}`.trim()} ref={rootRef}>
      <span>{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="target-combobox-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="target-combobox-label">{selectedOption?.label ?? "Select target"}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="target-combobox-popover">
          <label className="target-combobox-search">
            <Search size={14} />
            <input
              aria-label={`Search ${label}`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branch or path"
              ref={searchRef}
              value={query}
            />
          </label>
          <div aria-label={label} className="target-combobox-options" role="listbox">
            {filteredOptions.length === 0 ? (
              <div className="target-combobox-empty">No targets found.</div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  aria-selected={sameGitPath(option.path, value)}
                  className="target-combobox-option"
                  key={option.path}
                  onClick={() => selectOption(option.path)}
                  role="option"
                  type="button"
                >
                  <strong>{option.label}</strong>
                  <span className="mono">{option.path}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommitPanel({ project }: { project: ProjectSnapshot }) {
  const [limit, setLimit] = useState(5);
  const [range, setRange] = useState<CommitRange>("all");
  const [targetPath, setTargetPath] = useState(project.path);
  const [commits, setCommits] = useState<RecentCommit[]>(project.recentCommits);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetOptions = gitTargetOptions(project);

  useEffect(() => {
    setTargetPath(project.path);
    setCommits(project.recentCommits);
  }, [project.id, project.path, project.recentCommits]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getProjectCommits(project.id, { limit, path: targetPath, range })
      .then((nextCommits) => {
        if (!cancelled) setCommits(nextCommits);
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project.id, limit, range, targetPath]);

  return (
    <section className="section">
      <div className="commit-heading">
        <h3>Recent Commits</h3>
        <span className="mono">{gitTargetSummary(project, targetPath)}</span>
      </div>
      <div className="commit-controls">
        <label className="target-select">
          <span>Commit target</span>
          <select
            aria-label="Commit target"
            value={targetPath}
            onChange={(event) => setTargetPath(event.target.value)}
          >
            {targetOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <SegmentedControl>
          {([5, 20, 50] as const).map((count) => (
            <SegmentButton key={count} active={limit === count} onClick={() => setLimit(count)}>
              {count}
            </SegmentButton>
          ))}
        </SegmentedControl>
        <SegmentedControl>
          {(["24h", "7d", "30d", "all"] as const).map((nextRange) => (
            <SegmentButton key={nextRange} active={range === nextRange} onClick={() => setRange(nextRange)}>
              {commitRangeLabel(nextRange)}
            </SegmentButton>
          ))}
        </SegmentedControl>
      </div>
      {error ? <div className="error-banner compact">{error}</div> : null}
      {loading ? <div className="empty-state compact">Loading commits...</div> : null}
      {!loading && commits.length === 0 ? (
        <div className="empty-state compact">No commits available.</div>
      ) : (
        commits.map((commit) => (
          <div className="commit" key={commit.hash}>
            <strong>{commit.subject}</strong>
            <span className="mono">
              {commit.hash}, {commit.author}, {commit.relativeTime}
            </span>
          </div>
        ))
      )}
    </section>
  );
}

type GitPanelAction = GitSyncAction | "stash" | "stage" | "unstage" | "discard" | "commit";
type GitPanelScope = { generation: number; projectId: string; projectPath: string };
type GitMutationRequest = GitPanelScope & { requestId: number; worktreePath: string };
type GitDiscardTarget = { filePath: string };

function GitPanel({
  onGitChanged,
  project
}: {
  project: ProjectSnapshot;
  onGitChanged: (message: string) => Promise<void>;
}) {
  const requestScope = useRef({ generation: 0, projectId: project.id, projectPath: project.path });
  const statusRequestId = useRef(0);
  const diffRequestId = useRef(0);
  const mutationRequestId = useRef(0);
  const statusRef = useRef<GitOperationStatus | null>(null);
  const [status, setStatus] = useState<GitOperationStatus | null>(null);
  const [targetPath, setTargetPath] = useState(project.path);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<WorktreeDiffResponse | null>(null);
  const [message, setMessage] = useState("");
  const [discardTarget, setDiscardTarget] = useState<GitDiscardTarget | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [stashDialogOpen, setStashDialogOpen] = useState(false);
  const [stashFiles, setStashFiles] = useState<string[]>([]);
  const [stashError, setStashError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<GitPanelAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const targetOptions = gitTargetOptions(project);

  function refreshGitStatus(requestedTargetPath: string, options: { resetCommitMessage?: boolean } = {}) {
    const resolvedTargetPath = targetOptions.some((option) => sameGitPath(option.path, requestedTargetPath))
      ? requestedTargetPath
      : project.path;
    const nextScope = {
      generation: requestScope.current.generation + 1,
      projectId: project.id,
      projectPath: resolvedTargetPath
    };
    const requestId = statusRequestId.current + 1;
    requestScope.current = nextScope;
    statusRequestId.current = requestId;
    mutationRequestId.current += 1;
    statusRef.current = null;
    setStatus(null);
    resetDiffState();
    setDiscardTarget(null);
    setDiscardError(null);
    setStashDialogOpen(false);
    setStashFiles([]);
    setStashError(null);
    setLoading(true);
    setBusyAction(null);
    if (options.resetCommitMessage ?? true) {
      setMessage("");
    }
    setError(null);

    void getGitStatus(project.id, resolvedTargetPath)
      .then((nextStatus) => {
        if (!isCurrentStatusRequest(nextScope, requestId, nextStatus)) return;
        setCurrentStatus(nextStatus);
      })
      .catch((caught) => {
        if (!isCurrentStatusRequest(nextScope, requestId)) return;
        setError((caught as Error).message);
      })
      .finally(() => {
        if (isCurrentStatusRequest(nextScope, requestId)) {
          setLoading(false);
        }
      });
  }

  useEffect(() => {
    setTargetPath(project.path);
  }, [project.id, project.path]);

  useEffect(() => {
    refreshGitStatus(targetPath);

    return () => {
      statusRequestId.current += 1;
      diffRequestId.current += 1;
      mutationRequestId.current += 1;
    };
  }, [project.id, project.path, targetPath]);

  useEffect(() => {
    if (!status || !selectedFile || gitStatusHasFile(status, selectedFile)) return;
    resetDiffState();
  }, [selectedFile, status]);

  function resetDiffState() {
    diffRequestId.current += 1;
    setSelectedFile(null);
    setDiff(null);
    setDiffLoading(false);
    setDiffError(null);
  }

  function setCurrentStatus(nextStatus: GitOperationStatus) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  async function loadDiff(filePath: string) {
    if (!status) return;

    const requestId = diffRequestId.current + 1;
    const scope = requestScope.current;
    const worktreePath = status.worktreePath;
    diffRequestId.current = requestId;
    setSelectedFile(filePath);
    setDiff(null);
    setDiffLoading(true);
    setDiffError(null);

    try {
      const nextDiff = await getWorktreeDiff(project.id, worktreePath, filePath);
      if (!isCurrentDiffRequest(scope, requestId, worktreePath, nextDiff)) return;
      setDiff(nextDiff);
    } catch (caught) {
      if (!isCurrentDiffRequest(scope, requestId, worktreePath)) return;
      const message = (caught as Error).message;
      if (message === "Worktree not found." || message === "Changed file not found in worktree.") {
        refreshGitStatus(worktreePath, { resetCommitMessage: false });
        return;
      }
      setDiffError(message);
    } finally {
      if (isCurrentDiffRequest(scope, requestId, worktreePath)) {
        setDiffLoading(false);
      }
    }
  }

  async function runSyncAction(actionName: GitSyncAction) {
    if (!status || busyAction) return;

    const request = startMutationRequest(status.worktreePath);
    setBusyAction(actionName);
    setError(null);
    try {
      const result = await runGitOperation(project.id, actionName, { path: status.worktreePath });
      if (!applyMutationStatus(request, result.status)) return;
      await onGitChanged(`${syncActionPastTense(actionName)} ${project.name}.`);
    } catch (caught) {
      if (!isCurrentMutationRequest(request)) return;
      setError((caught as Error).message);
    } finally {
      if (isCurrentMutationRequest(request)) {
        setBusyAction(null);
      }
    }
  }

  function openStashDialog() {
    if (!status || busyAction) return;
    const changes = uniqueGitChanges(status.changes.staged.concat(status.changes.unstaged));
    setStashFiles(changes.map((change) => change.path));
    setStashError(null);
    setStashDialogOpen(true);
  }

  async function stashChanges(filePaths: string[]) {
    if (!status || busyAction || filePaths.length === 0) return;

    const request = startMutationRequest(status.worktreePath);
    setBusyAction("stash");
    setError(null);
    setStashError(null);
    try {
      const result = await runGitOperation(project.id, "stash", { path: status.worktreePath, files: filePaths });
      if (!applyMutationStatus(request, result.status)) return;
      setStashDialogOpen(false);
      setStashFiles([]);
      await onGitChanged(`Stashed changes for ${project.name}.`);
    } catch (caught) {
      if (!isCurrentMutationRequest(request)) return;
      setStashError((caught as Error).message);
    } finally {
      if (isCurrentMutationRequest(request)) {
        setBusyAction(null);
      }
    }
  }

  async function runFileAction(actionName: "stage" | "unstage", filePath: string) {
    if (!status || busyAction) return;

    const request = startMutationRequest(status.worktreePath);
    setBusyAction(actionName);
    setError(null);
    try {
      const result = await runGitOperation(project.id, actionName, { path: status.worktreePath, files: [filePath] });
      if (!applyMutationStatus(request, result.status)) return;
      await onGitChanged(actionName === "stage" ? `Staged ${filePath}.` : `Unstaged ${filePath}.`);
    } catch (caught) {
      if (!isCurrentMutationRequest(request)) return;
      setError((caught as Error).message);
    } finally {
      if (isCurrentMutationRequest(request)) {
        setBusyAction(null);
      }
    }
  }

  async function discardFileChange(filePath: string) {
    if (!status || busyAction) return;

    const request = startMutationRequest(status.worktreePath);
    setBusyAction("discard");
    setError(null);
    setDiscardError(null);
    try {
      const result = await runGitOperation(project.id, "discard", { path: status.worktreePath, files: [filePath] });
      if (!applyMutationStatus(request, result.status)) return;
      setDiscardTarget(null);
      await onGitChanged(`Discarded ${filePath}.`);
    } catch (caught) {
      if (!isCurrentMutationRequest(request)) return;
      setDiscardError((caught as Error).message);
    } finally {
      if (isCurrentMutationRequest(request)) {
        setBusyAction(null);
      }
    }
  }

  async function commitChanges(event: FormEvent) {
    event.preventDefault();
    if (!status || busyAction) return;

    const disabledReason = commitDisabledReason({ stagedCount: status.changes.staged.length, message });
    if (disabledReason) {
      setError(disabledReason);
      return;
    }

    setBusyAction("commit");
    const request = startMutationRequest(status.worktreePath);
    setError(null);
    try {
      const result = await runGitOperation(project.id, "commit", { path: status.worktreePath, message });
      if (!applyMutationStatus(request, result.status)) return;
      setMessage("");
      await onGitChanged(`Committed ${project.name}.`);
    } catch (caught) {
      if (!isCurrentMutationRequest(request)) return;
      setError((caught as Error).message);
    } finally {
      if (isCurrentMutationRequest(request)) {
        setBusyAction(null);
      }
    }
  }

  function startMutationRequest(worktreePath: string) {
    const requestId = mutationRequestId.current + 1;
    mutationRequestId.current = requestId;
    return { ...requestScope.current, requestId, worktreePath };
  }

  function applyMutationStatus(request: GitMutationRequest, nextStatus: GitOperationStatus) {
    if (!isCurrentMutationRequest(request, nextStatus)) return false;
    resetDiffState();
    setCurrentStatus(nextStatus);
    return true;
  }

  function isCurrentStatusRequest(
    scope: GitPanelScope,
    requestId: number,
    nextStatus?: GitOperationStatus
  ) {
    return (
      statusRequestId.current === requestId &&
      isCurrentScope(scope) &&
      (!nextStatus ||
        (nextStatus.projectId === scope.projectId && sameGitPath(nextStatus.worktreePath, scope.projectPath)))
    );
  }

  function isCurrentDiffRequest(
    scope: GitPanelScope,
    requestId: number,
    worktreePath: string,
    nextDiff?: WorktreeDiffResponse
  ) {
    return (
      diffRequestId.current === requestId &&
      isCurrentScope(scope) &&
      Boolean(statusRef.current && sameGitPath(statusRef.current.worktreePath, worktreePath)) &&
      (!nextDiff || sameGitPath(nextDiff.worktreePath, worktreePath))
    );
  }

  function isCurrentMutationRequest(request: GitMutationRequest, nextStatus?: GitOperationStatus) {
    return (
      mutationRequestId.current === request.requestId &&
      isCurrentScope(request) &&
      Boolean(statusRef.current && sameGitPath(statusRef.current.worktreePath, request.worktreePath)) &&
      (!nextStatus ||
        (nextStatus.projectId === request.projectId && sameGitPath(nextStatus.worktreePath, request.worktreePath)))
    );
  }

  function isCurrentScope(scope: GitPanelScope) {
    const currentScope = requestScope.current;
    return (
      currentScope.generation === scope.generation &&
      currentScope.projectId === scope.projectId &&
      sameGitPath(currentScope.projectPath, scope.projectPath)
    );
  }

  function renderChangeRows(changes: WorktreeChange[], actionName: "stage" | "unstage") {
    if (changes.length === 0) {
      return <div className="empty-state compact">No {actionName === "stage" ? "unstaged" : "staged"} files.</div>;
    }

    return changes.map((change) => {
      const selected = selectedFile === change.path;
      return (
        <div className={`git-file-row ${selected ? "selected" : ""}`} key={`${actionName}-${change.code}-${change.path}`}>
          <button
            className="git-file-select"
            onClick={() => void loadDiff(change.path)}
            type="button"
          >
            <span className={`change-code ${changeTone(change.code)}`}>{change.code}</span>
            <span className="mono">{change.path}</span>
          </button>
          <div className="git-file-actions">
            <Button
              disabled={Boolean(busyAction)}
              title={actionName === "stage" ? "Move into staged files" : "Move out of staged files"}
              onClick={() => void runFileAction(actionName, change.path)}
            >
              {actionName === "unstage" ? <Undo2 size={13} /> : <Check size={13} />}
              {shortGitActionLabel(actionName)}
            </Button>
            <Button
              disabled={Boolean(busyAction)}
              title={`Discard local changes in ${change.path}`}
              variant="danger"
              onClick={() => {
                setDiscardError(null);
                setDiscardTarget({ filePath: change.path });
              }}
            >
              <Trash2 size={13} />
              Discard
            </Button>
          </div>
        </div>
      );
    });
  }

  const totalChanges = status ? status.changes.staged.length + status.changes.unstaged.length : 0;
  const commitReason = status
    ? commitDisabledReason({ stagedCount: status.changes.staged.length, message })
    : "Loading git status.";
  const stashReason = !status ? "Loading git status." : status.clean ? "No local changes to stash." : null;
  const syncActions: GitSyncAction[] = ["fetch", "pull", "push"];
  const stashableChanges = status ? uniqueGitChanges(status.changes.staged.concat(status.changes.unstaged)) : [];

  return (
    <section className={gitPanelLayoutClass()}>
      <div className="section-heading">
        <h3>Git</h3>
        {status ? (
          <Badge tone={status.clean ? "clean" : "dirty"}>{status.clean ? "Clean" : `${totalChanges} changed`}</Badge>
        ) : null}
      </div>

      <GitTargetPicker
        className="git-target-select"
        label="Git target"
        onChange={setTargetPath}
        options={targetOptions}
        value={targetPath}
      />

      <div className="git-summary-grid">
        <div className="git-card">
          <div className="git-card-heading">
            <h4>Status</h4>
            {loading ? <Badge>Loading</Badge> : null}
          </div>
          {loading ? (
            <div className="empty-state compact">Loading git status...</div>
          ) : status ? (
            <div className="git-meta-grid">
              <span>Branch</span>
              <strong className="mono">{status.branch}</strong>
              <span>Upstream</span>
              <strong className="mono">{status.upstream ?? "No upstream"}</strong>
              <span>Ahead / behind</span>
              <strong>
                {status.ahead} / {status.behind}
              </strong>
              <span>Worktree</span>
              <strong className="mono">{status.worktreePath}</strong>
            </div>
          ) : (
            <div className="empty-state compact">Git status is unavailable.</div>
          )}
        </div>

        <div className="git-card">
          <div className="git-card-heading">
            <h4>Sync</h4>
            {status ? <span className="mono">{status.stashes.length} stashes</span> : null}
          </div>
          <div className="git-actions">
            {syncActions.map((actionName) => {
              const disabledReason = status ? gitSyncDisabledReason(actionName, status) : "Loading git status.";
              return (
                <Button
                  disabled={Boolean(disabledReason) || Boolean(busyAction)}
                  key={actionName}
                  title={disabledReason ?? syncActionTitle(actionName)}
                  onClick={() => void runSyncAction(actionName)}
                >
                  {actionName === "fetch" ? (
                    <RefreshCw size={14} />
                  ) : actionName === "pull" ? (
                    <Download size={14} />
                  ) : (
                    <Upload size={14} />
                  )}
                  {syncActionLabel(actionName)}
                </Button>
              );
            })}
            <Button
              disabled={Boolean(stashReason) || Boolean(busyAction)}
              title={stashReason ?? "Stash local changes"}
              onClick={() => openStashDialog()}
            >
              <Archive size={14} />
              {busyAction === "stash" ? "Stashing..." : "Stash changes"}
            </Button>
          </div>
        </div>
      </div>

      {error ? <div className="error-banner compact">{error}</div> : null}

      {status ? (
        <div className="git-workspace">
          <div className="git-column git-changes-column">
            <div className="git-column-heading">
              <h4>Changed files</h4>
              <Badge tone={totalChanges === 0 ? "clean" : "dirty"}>{totalChanges}</Badge>
            </div>
            <div className="git-change-group">
              <div className="git-change-group-heading">
                <span>Unstaged</span>
                <Badge tone={status.changes.unstaged.length === 0 ? "clean" : "dirty"}>
                  {status.changes.unstaged.length}
                </Badge>
              </div>
              <div className="git-file-list">{renderChangeRows(status.changes.unstaged, "stage")}</div>
            </div>
            <div className="git-change-group">
              <div className="git-change-group-heading">
                <span>Staged</span>
                <Badge tone={status.changes.staged.length === 0 ? "neutral" : "dirty"}>
                  {status.changes.staged.length}
                </Badge>
              </div>
              <div className="git-file-list">{renderChangeRows(status.changes.staged, "unstage")}</div>
            </div>
            <div className="git-commit-section">
              <div className="git-column-heading">
                <h4>Commit</h4>
                <Badge tone={status.changes.staged.length === 0 ? "neutral" : "dirty"}>
                  {status.changes.staged.length} staged
                </Badge>
              </div>
              <form className="git-commit-form" onSubmit={(event) => void commitChanges(event)}>
                <label>
                  <span>Commit message</span>
                  <textarea
                    placeholder="Describe the staged change"
                    rows={4}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <Button
                  disabled={Boolean(commitReason) || Boolean(busyAction)}
                  title={commitReason ?? "Commit staged files"}
                  type="submit"
                  variant="primary"
                >
                  <Check size={14} />
                  {busyAction === "commit" ? "Committing..." : "Commit"}
                </Button>
              </form>
            </div>
          </div>

          <div className="git-diff">
            <div className="git-column-heading">
              <h4>Diff</h4>
              {selectedFile ? <span className="git-diff-file">{selectedFile}</span> : null}
            </div>
            {diffLoading ? (
              <div className="empty-state compact">Loading diff...</div>
            ) : diffError ? (
              <div className="error-banner compact">{diffError}</div>
            ) : diff ? (
              <>
                {diff.truncated ? (
                  <div className="git-diff-note">
                    <Badge tone="dirty">Truncated</Badge>
                    <span>{diff.lineCount} diff lines</span>
                  </div>
                ) : null}
                <DiffPreview diff={diff} />
              </>
            ) : (
              <div className="empty-state compact">Select a file to preview its diff.</div>
            )}
          </div>

        </div>
      ) : null}
      <ConfirmDiscardDialog
        busy={busyAction === "discard"}
        error={discardError}
        target={discardTarget}
        worktreePath={status?.worktreePath ?? null}
        onCancel={() => {
          if (busyAction === "discard") return;
          setDiscardTarget(null);
          setDiscardError(null);
        }}
        onConfirm={async () => {
          if (!discardTarget) return;
          await discardFileChange(discardTarget.filePath);
        }}
      />
      <ConfirmStashDialog
        busy={busyAction === "stash"}
        changes={stashableChanges}
        error={stashError}
        open={stashDialogOpen}
        selectedFiles={stashFiles}
        worktreePath={status?.worktreePath ?? null}
        onCancel={() => {
          if (busyAction === "stash") return;
          setStashDialogOpen(false);
          setStashFiles([]);
          setStashError(null);
        }}
        onConfirm={async () => {
          await stashChanges(stashFiles);
        }}
        onSelectedFilesChange={setStashFiles}
      />
    </section>
  );
}

function ConfirmDiscardDialog({
  busy,
  error,
  onCancel,
  onConfirm,
  target,
  worktreePath
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  target: GitDiscardTarget | null;
  worktreePath: string | null;
}) {
  return (
    <Dialog open={!!target} title="Discard file changes" onOpenChange={(open) => !open && onCancel()}>
      {target ? (
        <div className="confirm-body">
          <p>This will permanently discard the selected local change from the worktree.</p>
          <div className="confirm-target">
            <span>File</span>
            <code>{target.filePath}</code>
          </div>
          {worktreePath ? (
            <div className="confirm-target">
              <span>Worktree</span>
              <code>{worktreePath}</code>
            </div>
          ) : null}
          {error ? <div className="error-banner compact">{error}</div> : null}
          <footer className="dialog-footer">
            <Button disabled={busy} type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button disabled={busy} type="button" variant="danger" onClick={() => void onConfirm()}>
              {busy ? "Discarding..." : "Confirm Discard"}
            </Button>
          </footer>
        </div>
      ) : null}
    </Dialog>
  );
}

function ConfirmStashDialog({
  busy,
  changes,
  error,
  onCancel,
  onConfirm,
  onSelectedFilesChange,
  open,
  selectedFiles,
  worktreePath
}: {
  busy: boolean;
  changes: WorktreeChange[];
  error: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onSelectedFilesChange: (files: string[]) => void;
  open: boolean;
  selectedFiles: string[];
  worktreePath: string | null;
}) {
  const selected = new Set(selectedFiles);
  const allSelected = changes.length > 0 && selectedFiles.length === changes.length;

  function toggleFile(filePath: string) {
    if (selected.has(filePath)) {
      onSelectedFilesChange(selectedFiles.filter((candidate) => candidate !== filePath));
      return;
    }
    onSelectedFilesChange([...selectedFiles, filePath]);
  }

  return (
    <Dialog open={open} title="Stash selected changes" onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <div className="confirm-body">
        <p>Select the files to move into a stash. Unselected files will stay in the worktree.</p>
        {worktreePath ? (
          <div className="confirm-target">
            <span>Worktree</span>
            <code>{worktreePath}</code>
          </div>
        ) : null}
        <div className="stash-file-toolbar">
          <span>{selectedFiles.length} selected</span>
          <div>
            <Button
              disabled={busy || allSelected}
              type="button"
              variant="ghost"
              onClick={() => onSelectedFilesChange(changes.map((change) => change.path))}
            >
              Select all
            </Button>
            <Button
              disabled={busy || selectedFiles.length === 0}
              type="button"
              variant="ghost"
              onClick={() => onSelectedFilesChange([])}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="stash-file-list">
          {changes.map((change) => (
            <label className="stash-file-option" key={change.path}>
              <input
                aria-label={change.path}
                checked={selected.has(change.path)}
                disabled={busy}
                type="checkbox"
                onChange={() => toggleFile(change.path)}
              />
              <span className={`change-code ${changeTone(change.code)}`}>{change.code}</span>
              <span className="mono">{change.path}</span>
            </label>
          ))}
        </div>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <footer className="dialog-footer">
          <Button disabled={busy} type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy || selectedFiles.length === 0} type="button" variant="primary" onClick={() => void onConfirm()}>
            {busy ? "Stashing..." : "Stash selected files"}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}

function ServicePanel({
  onAddService,
  onDeleteService,
  onServiceChanged,
  project
}: {
  project: ProjectSnapshot;
  onAddService: (project: ProjectSnapshot) => void;
  onDeleteService: (project: ProjectSnapshot, service: ServiceSnapshot) => void;
  onServiceChanged: (message: string) => Promise<void>;
}) {
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const groupBusyRef = useRef(false);
  const groupActionRequestId = useRef(0);
  const keepGroupErrorsForNextSnapshot = useRef(false);
  const [groupBusy, setGroupBusy] = useState<{ id: string; action: ServiceGroupAction | "delete" } | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<Record<string, string[]>>({});
  const [externalStopService, setExternalStopService] = useState<ServiceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serviceGroups = project.serviceGroups ?? [];
  const detectedServices = project.detectedServices ?? [];

  useEffect(() => {
    groupActionRequestId.current += 1;
    groupBusyRef.current = false;
    keepGroupErrorsForNextSnapshot.current = false;
    setGroupBusy(null);
    setGroupDialogOpen(false);
    setGroupErrors({});
    setExternalStopService(null);
  }, [project.id]);

  useEffect(() => {
    if (keepGroupErrorsForNextSnapshot.current) {
      keepGroupErrorsForNextSnapshot.current = false;
      return;
    }
    setGroupErrors({});
  }, [project.serviceGroups]);

  async function runServiceAction(
    service: ServiceSnapshot,
    actionName: "start" | "stop" | "restart",
    options: { externalStopConfirmed?: boolean } = {}
  ) {
    if (
      actionName === "stop" &&
      serviceExternalStopConfirmation(service) &&
      !options.externalStopConfirmed
    ) {
      setExternalStopService(service);
      return;
    }

    setBusyServiceId(service.id);
    setError(null);
    try {
      if (actionName === "start") {
        await startService(project.id, service.id);
        await onServiceChanged(`Started ${service.name}.`);
      } else if (actionName === "stop") {
        await stopService(project.id, service.id);
        await onServiceChanged(`Stopped ${service.name}.`);
      } else {
        await restartService(project.id, service.id);
        await onServiceChanged(`Restarted ${service.name}.`);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyServiceId(null);
    }
  }

  async function runGroupAction(group: ServiceGroupSnapshot, actionName: ServiceGroupAction) {
    if (groupBusyRef.current) return;

    const requestId = groupActionRequestId.current + 1;
    groupActionRequestId.current = requestId;
    groupBusyRef.current = true;
    setGroupBusy({ id: group.id, action: actionName });
    setGroupErrors((current) => {
      const next = { ...current };
      delete next[group.id];
      return next;
    });
    try {
      const response =
        actionName === "start"
          ? await startServiceGroup(project.id, group.id)
          : actionName === "stop"
            ? await stopServiceGroup(project.id, group.id)
            : await restartServiceGroup(project.id, group.id);
      if (groupActionRequestId.current !== requestId) return;
      const errorSummary = serviceGroupActionErrorSummary(response);
      if (errorSummary) {
        keepGroupErrorsForNextSnapshot.current = true;
        setGroupErrors((current) => ({ ...current, [group.id]: errorSummary }));
      }
      await onServiceChanged(serviceGroupActionNotice(response));
    } catch (caught) {
      if (groupActionRequestId.current === requestId) {
        setGroupErrors((current) => ({ ...current, [group.id]: (caught as Error).message }));
      }
    } finally {
      if (groupActionRequestId.current === requestId) {
        groupBusyRef.current = false;
        setGroupBusy(null);
      }
    }
  }

  async function deleteGroup(group: ServiceGroupSnapshot) {
    const confirmed = window.confirm(
      `Remove service group "${group.name}"? The individual service registrations will remain.`
    );
    if (!confirmed) return;
    if (groupBusyRef.current) return;

    const requestId = groupActionRequestId.current + 1;
    groupActionRequestId.current = requestId;
    groupBusyRef.current = true;
    setGroupBusy({ id: group.id, action: "delete" });
    setGroupErrors((current) => {
      const next = { ...current };
      delete next[group.id];
      return next;
    });
    try {
      await removeServiceGroup(project.id, group.id);
      if (groupActionRequestId.current !== requestId) return;
      await onServiceChanged(`Removed service group ${group.name}.`);
    } catch (caught) {
      if (groupActionRequestId.current === requestId) {
        setGroupErrors((current) => ({ ...current, [group.id]: (caught as Error).message }));
      }
    } finally {
      if (groupActionRequestId.current === requestId) {
        groupBusyRef.current = false;
        setGroupBusy(null);
      }
    }
  }

  async function refreshLogs(service: ServiceSnapshot) {
    setBusyServiceId(service.id);
    setError(null);
    try {
      const lines = await getServiceLogs(project.id, service.id);
      setLogLines((current) => ({ ...current, [service.id]: lines }));
      setExpandedLogs(service.id);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyServiceId(null);
    }
  }

  return (
    <section className="section service-panel">
      <div className="section-heading">
        <h3>Services</h3>
        <div className="section-actions">
          <Button
            disabled={project.services.length === 0}
            title={project.services.length === 0 ? "Add a service before creating a group" : "Add service group"}
            onClick={() => setGroupDialogOpen(true)}
          >
            <Plus size={14} />
            Add Service Group
          </Button>
          <Button onClick={() => onAddService(project)}>
            <Plus size={14} />
            Add Service
          </Button>
        </div>
      </div>
      {error ? <div className="error-banner compact">{error}</div> : null}
      <div className="service-groups">
        <div className="service-subheading">Service Groups</div>
        {project.services.length === 0 ? (
          <div className="empty-state compact">Add services before grouping them.</div>
        ) : serviceGroups.length === 0 ? (
          <div className="empty-state compact">No service groups yet.</div>
        ) : (
          <div className="service-group-list">
            {serviceGroups.map((group) => {
              const groupActionBusy = groupBusy !== null;
              const activeGroupBusy = groupBusy?.id === group.id;
              const serviceCount = group.services.length;
              const groupError = groupErrors[group.id];
              return (
                <article className="service-group-card" key={group.id}>
                  <div className="service-group-top">
                    <div className="service-group-main">
                      <strong title={group.name}>{group.name}</strong>
                    </div>
                    <span className="service-badges">
                      <Badge tone={serviceGroupStatusTone(group.status)}>
                        {serviceGroupStatusLabel(group.status)}
                      </Badge>
                      <Badge>{serviceCountLabel(group.serviceIds.length)}</Badge>
                    </span>
                  </div>

                  <div className="service-member-list" aria-label={`${group.name} services`}>
                    {group.services.length === 0 ? (
                      <span className="service-member-chip muted">
                        <span>No services</span>
                      </span>
                    ) : (
                      group.services.map((service) => (
                        <span className="service-member-chip" key={service.id} title={service.name}>
                          <span>{service.name}</span>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="service-group-actions">
                    <Button
                      disabled={groupActionBusy || serviceGroupActionDisabled("start", group.status, serviceCount)}
                      title="Start group"
                      onClick={() => void runGroupAction(group, "start")}
                    >
                      <Play size={14} />
                      {serviceGroupActionLabel("start", activeGroupBusy && groupBusy?.action === "start")}
                    </Button>
                    <Button
                      disabled={groupActionBusy || serviceGroupActionDisabled("stop", group.status, serviceCount)}
                      title="Stop group"
                      onClick={() => void runGroupAction(group, "stop")}
                    >
                      <Square size={13} />
                      {serviceGroupActionLabel("stop", activeGroupBusy && groupBusy?.action === "stop")}
                    </Button>
                    <Button
                      disabled={groupActionBusy || serviceGroupActionDisabled("restart", group.status, serviceCount)}
                      title="Restart group"
                      onClick={() => void runGroupAction(group, "restart")}
                    >
                      <RotateCcw size={14} />
                      {serviceGroupActionLabel("restart", activeGroupBusy && groupBusy?.action === "restart")}
                    </Button>
                    <Button
                      aria-label={`Remove service group ${group.name}`}
                      disabled={groupActionBusy}
                      size="icon"
                      title={`Remove service group ${group.name}`}
                      variant="ghost"
                      onClick={() => void deleteGroup(group)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  {groupError ? <div className="error-banner compact service-group-error">{groupError}</div> : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
      <div className="detected-services">
        <div className="service-subheading">Detected Worktree Services</div>
        {detectedServices.length === 0 ? (
          <div className="empty-state compact">No unregistered listening services detected in project worktrees.</div>
        ) : (
          <div className="service-list">
            {detectedServices.map((service) => (
              <article className="service-card" key={service.id}>
                <div className="service-top">
                  <div className="service-title-row">
                    <strong>{service.processName ?? `Process ${service.pid}`}</strong>
                    <span className="service-badges">
                      <Badge tone="clean">Listening</Badge>
                      <ExplainableBadge
                        align="right"
                        tooltip="Detected because this listening process is running from inside the Git worktree."
                      >
                        Auto-detected
                      </ExplainableBadge>
                    </span>
                  </div>
                </div>

                <div className="service-meta">
                  <span className="service-path">
                    <span className="service-meta-label">Launch path</span>
                    <span className="mono">{service.processCwd ?? service.worktreePath}</span>
                  </span>
                  <span className="service-path">
                    <span className="service-meta-label">Worktree</span>
                    <span className="mono">{service.worktreePath}</span>
                  </span>
                  {service.branch ? <span className="service-secondary">Branch {service.branch}</span> : null}
                  <span className="service-secondary">PID {service.pid}</span>
                </div>

                <div className="port-list">
                  {service.ports.map((port) => (
                    <span className="port-chip" key={port}>
                      {port}
                      <em>listening:{service.pid}</em>
                    </span>
                  ))}
                </div>

                <div className="service-actions">
                  <Button
                    title={`Open port ${service.ports[0]}`}
                    onClick={() => window.open(`http://127.0.0.1:${service.ports[0]}`, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink size={14} />
                    Open
                  </Button>
                  <span className="service-secondary">Read-only discovery</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="service-subheading">Individual Services</div>
      {project.services.length === 0 ? (
        <div className="empty-state compact">No services registered for this project.</div>
      ) : (
        <div className="service-list">
          {project.services.map((service) => {
            const busy = busyServiceId === service.id;
            const url = serviceUrl(service);
            const lines = logLines[service.id] ?? service.logPreview;
            const configuredPath = serviceConfiguredPath(service);
            return (
              <article className="service-card" key={service.id}>
                <div className="service-top">
                  <div className="service-title-row">
                    <strong>{service.name}</strong>
                    <span className="service-badges">
                      <ExplainableBadge align="right" tone={serviceStatusTone(service)} tooltip={serviceStatusTooltip(service)}>
                        {serviceStatusLabel(service)}
                      </ExplainableBadge>
                      <ExplainableBadge
                        align="right"
                        tone={service.startedByConsole ? "clean" : "neutral"}
                        tooltip={serviceKindTooltip(service)}
                      >
                        {serviceKindLabel(service)}
                      </ExplainableBadge>
                    </span>
                  </div>
                  <span className="service-command mono">{service.command}</span>
                </div>

                <div className="service-meta">
                  <span className="service-path">
                    <span className="service-meta-label">Launch path</span>
                    <span className="mono">{serviceLaunchPath(service)}</span>
                  </span>
                  {configuredPath ? (
                    <span className="service-path">
                      <span className="service-meta-label">Configured path</span>
                      <span className="mono">{configuredPath}</span>
                    </span>
                  ) : null}
                  <span className="service-secondary">{servicePortLabel(service)}</span>
                  {service.pid ? <span className="service-secondary">PID {service.pid}</span> : null}
                </div>

                {service.portsStatus.length > 0 ? (
                  <div className="port-list">
                    {service.portsStatus.map((port) => (
                      <span className="port-chip explainable" data-tooltip={portTooltip(port)} key={port.port}>
                        {port.port}
                        <em>{port.listening ? `listening${port.pid ? `:${port.pid}` : ""}` : "free"}</em>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="service-actions">
                  <Button
                    disabled={busy || service.startedByConsole || service.status === "running" || service.status === "port-occupied"}
                    title={servicePrimaryActionLabel(service)}
                    onClick={() => void runServiceAction(service, "start")}
                  >
                    <Play size={14} />
                    {servicePrimaryActionLabel(service)}
                  </Button>
                  {serviceShowProcessControls(service) ? (
                    <>
                      <Button
                        disabled={busy || !serviceCanStop(service)}
                        title={serviceStopTitle(service)}
                        onClick={() => void runServiceAction(service, "stop")}
                      >
                        <Square size={13} />
                        Stop
                      </Button>
                      <Button
                        disabled={busy || !serviceCanRestart(service)}
                        title={serviceRestartTitle(service)}
                        onClick={() => void runServiceAction(service, "restart")}
                      >
                        <RotateCcw size={14} />
                        Restart
                      </Button>
                    </>
                  ) : null}
                  {url ? (
                    <Button title="Open service URL" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
                      <ExternalLink size={14} />
                      Open
                    </Button>
                  ) : null}
                  <Button disabled={busy} title="Show logs" variant="ghost" onClick={() => void refreshLogs(service)}>
                    Logs
                  </Button>
                  <Button
                    aria-label={`Remove service ${service.name}`}
                    disabled={service.startedByConsole}
                    size="icon"
                    title={`Remove service ${service.name}`}
                    variant="ghost"
                    onClick={() => onDeleteService(project, service)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>

                {expandedLogs === service.id && lines.length > 0 ? (
                  <pre className="service-log">{lines.join("\n")}</pre>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      <AddServiceGroupDialog
        open={groupDialogOpen}
        project={project}
        onOpenChange={setGroupDialogOpen}
        onAdded={async (groupName) => {
          setGroupDialogOpen(false);
          await onServiceChanged(`Added service group ${groupName}.`);
        }}
      />
      <ServiceExternalStopDialog
        busy={externalStopService ? busyServiceId === externalStopService.id : false}
        service={externalStopService}
        onCancel={() => setExternalStopService(null)}
        onConfirm={async (service) => {
          setExternalStopService(null);
          await runServiceAction(service, "stop", { externalStopConfirmed: true });
        }}
      />
    </section>
  );
}

function serviceCountLabel(count: number) {
  return `${count} service${count === 1 ? "" : "s"}`;
}

function serviceStopTitle(service: ServiceSnapshot) {
  if (serviceCanStop(service)) {
    return service.processOwnership === "project"
      ? "Stop external process matched to this project"
      : "Stop";
  }
  if (service.processOwnership === "unknown") {
    return "Stop disabled because the listening process was not matched to this project";
  }
  return "Stop";
}

function serviceRestartTitle(service: ServiceSnapshot) {
  if (serviceCanRestart(service)) return "Restart";
  if (service.processOwnership === "project") return "Restart is available only for console-started processes";
  return "Restart";
}

function ServiceExternalStopDialog({
  busy,
  onCancel,
  onConfirm,
  service
}: {
  busy: boolean;
  service: ServiceSnapshot | null;
  onCancel: () => void;
  onConfirm: (service: ServiceSnapshot) => Promise<void>;
}) {
  const confirmation = service ? serviceExternalStopConfirmation(service) : null;

  return (
    <Dialog
      open={!!confirmation}
      title={confirmation?.title ?? "Stop external service"}
      onOpenChange={(open) => !open && onCancel()}
    >
      {service && confirmation ? (
        <div className="confirm-body">
          <p>{confirmation.description}</p>
          {confirmation.details.map((detail) => (
            <div className="confirm-target" key={detail.label}>
              <span>{detail.label}</span>
              <code>{detail.value}</code>
            </div>
          ))}
          <p>{confirmation.footer}</p>
          <footer className="dialog-footer">
            <Button disabled={busy} type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button disabled={busy} type="button" variant="danger" onClick={() => void onConfirm(service)}>
              {busy ? "Stopping..." : "Stop Service"}
            </Button>
          </footer>
        </div>
      ) : null}
    </Dialog>
  );
}

function serviceGroupActionNotice(response: ServiceGroupActionResponse) {
  const actionLabel =
    response.action === "start" ? "Started group" : response.action === "stop" ? "Stopped group" : "Restarted group";
  if (response.errors.length === 0) {
    return `${actionLabel} ${response.groupName}.`;
  }
  return `${actionLabel} ${response.groupName} with ${response.errors.length} failed.`;
}

function serviceGroupActionErrorSummary(response: ServiceGroupActionResponse) {
  if (response.errors.length === 0) return null;
  const details = response.errors
    .slice(0, 3)
    .map((result) => `${result.serviceName}: ${result.error ?? "failed"}`)
    .join("; ");
  const remainder = response.errors.length > 3 ? `; +${response.errors.length - 3} more` : "";
  return `${response.errors.length} ${response.errors.length === 1 ? "service" : "services"} failed: ${details}${remainder}`;
}

function AddProjectDialog({
  onAdded,
  onOpenChange,
  open
}: {
  open: boolean;
  onAdded: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await addProject({
        path,
        name: name || undefined,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      });
      setPath("");
      setName("");
      setTags("");
      await onAdded();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBrowseFolder() {
    setError(null);
    try {
      const selectedPath = await selectFolder();
      if (selectedPath) setPath(selectedPath);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <Dialog open={open} title="Add Registered Project" onOpenChange={onOpenChange}>
      <form className="project-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>Project path</span>
          <span className="input-with-action">
            <Input required placeholder="C:\Dev\my-repo" value={path} onChange={(event) => setPath(event.target.value)} />
            <Button title="Browse local folders" type="button" onClick={() => void handleBrowseFolder()}>
              <FolderOpen size={14} />
              Browse
            </Button>
          </span>
        </label>
        <label>
          <span>Display name</span>
          <Input placeholder="Optional" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>Tags</span>
          <Input placeholder="internal, client" value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} type="submit" variant="primary">
            {submitting ? "Adding..." : "Add Project"}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

function EditProjectDialog({
  onOpenChange,
  onSaved,
  project
}: {
  project: ProjectSnapshot | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (projectName: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setSubmitting(false);
      setError(null);
    }
  }, [project]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    const nextName = name.trim();
    if (!nextName) {
      setError("Display name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateProjectName(project.id, nextName);
      await onSaved(updated.name);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!project} title="Edit Project Name" onOpenChange={onOpenChange}>
      <form className="project-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>Display name</span>
          <Input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="confirm-target">
          <span>Project path</span>
          <code>{project?.path}</code>
        </div>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} type="submit" variant="primary">
            {submitting ? "Saving..." : "Save Name"}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

function AddServiceGroupDialog({
  onAdded,
  onOpenChange,
  open,
  project
}: {
  project: ProjectSnapshot;
  open: boolean;
  onAdded: (groupName: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSelectedServiceIds([]);
      setSubmitting(false);
      setError(null);
    }
  }, [open, project.id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const groupName = name.trim();
    const availableServiceIds = new Set(project.services.map((service) => service.id));
    const serviceIds = selectedServiceIds.filter((serviceId) => availableServiceIds.has(serviceId));

    if (!groupName) {
      setError("Group name is required.");
      return;
    }
    if (serviceIds.length === 0) {
      setError("Select at least one service.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const group = await addServiceGroup(project.id, { name: groupName, serviceIds });
      await onAdded(group.name);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleService(serviceId: string) {
    setSelectedServiceIds((current) =>
      current.includes(serviceId)
        ? current.filter((candidate) => candidate !== serviceId)
        : [...current, serviceId]
    );
  }

  return (
    <Dialog open={open} title="Add Service Group" onOpenChange={onOpenChange}>
      <form className="project-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>Group name</span>
          <Input required placeholder="Core services" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="service-checklist-field">
          <span>Services</span>
          {project.services.length === 0 ? (
            <div className="empty-state compact">No services registered.</div>
          ) : (
            <div className="service-checklist">
              {project.services.map((service) => (
                <label className="service-check-option" key={service.id}>
                  <input
                    checked={selectedServiceIds.includes(service.id)}
                    type="checkbox"
                    onChange={() => toggleService(service.id)}
                  />
                  <span className="service-check-text">
                    <strong>{service.name}</strong>
                    <span className="mono">{service.command}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting || project.services.length === 0} type="submit" variant="primary">
            {submitting ? "Adding..." : "Add Group"}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

function AddServiceDialog({
  onAdded,
  onOpenChange,
  project
}: {
  project: ProjectSnapshot | null;
  onAdded: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [command, setCommand] = useState("");
  const [ports, setPorts] = useState("");
  const [healthUrl, setHealthUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setName("");
      setCwd(project.path);
      setCommand("");
      setPorts("");
      setHealthUrl("");
      setError(null);
      setSubmitting(false);
    }
  }, [project]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    setSubmitting(true);
    setError(null);
    try {
      await addService(project.id, {
        name,
        cwd,
        command,
        ports: parsePortInput(ports),
        healthUrl: healthUrl || null
      });
      await onAdded();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBrowseFolder() {
    setError(null);
    try {
      const selectedPath = await selectFolder();
      if (selectedPath) setCwd(selectedPath);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <Dialog open={!!project} title="Add Service" onOpenChange={onOpenChange}>
      <form className="project-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>Service name</span>
          <Input required placeholder="Admin service" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>Working directory</span>
          <span className="input-with-action">
            <Input required value={cwd} onChange={(event) => setCwd(event.target.value)} />
            <Button title="Browse local folders" type="button" onClick={() => void handleBrowseFolder()}>
              <FolderOpen size={14} />
              Browse
            </Button>
          </span>
        </label>
        <label>
          <span>Start command</span>
          <Input required placeholder="npm run dev" value={command} onChange={(event) => setCommand(event.target.value)} />
        </label>
        <label>
          <span>Ports</span>
          <Input placeholder="5274, 4218" value={ports} onChange={(event) => setPorts(event.target.value)} />
        </label>
        <label>
          <span>Health URL</span>
          <Input placeholder="http://127.0.0.1:5274/health" value={healthUrl} onChange={(event) => setHealthUrl(event.target.value)} />
        </label>
        {error ? <div className="error-banner compact">{error}</div> : null}
        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} type="submit" variant="primary">
            {submitting ? "Adding..." : "Add Service"}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

function ConfirmDeleteDialog({
  action,
  onCancel,
  onConfirm
}: {
  action: ConfirmAction | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubmitting(false);
    setError(null);
  }, [action]);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError((caught as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!action} title={action?.title ?? "Confirm delete"} onOpenChange={(open) => !open && onCancel()}>
      {action ? (
        <div className="confirm-body">
          <p>{action.description}</p>
          <div className="confirm-target">
            <span>{confirmTargetLabel(action)}</span>
            <code>{confirmTargetValue(action)}</code>
          </div>
          {error ? <div className="error-banner compact">{error}</div> : null}
          <footer className="dialog-footer">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button disabled={submitting} type="button" variant="danger" onClick={() => void handleConfirm()}>
              {submitting ? "Deleting..." : "Confirm Delete"}
            </Button>
          </footer>
        </div>
      ) : null}
    </Dialog>
  );
}

function ExplainableBadge({
  align = "center",
  children,
  tone = "neutral",
  tooltip
}: {
  align?: "center" | "right";
  children: ReactNode;
  tone?: "neutral" | "clean" | "dirty" | "error";
  tooltip: string;
}) {
  return (
    <Badge className={`explainable ${align === "right" ? "tooltip-right" : ""}`} data-tooltip={tooltip} tone={tone}>
      {children}
    </Badge>
  );
}

function ExplainableText({
  children,
  className,
  tooltip
}: {
  children: ReactNode;
  className?: string;
  tooltip: string;
}) {
  return (
    <span className={`${className ?? ""} explainable text-hint`} data-tooltip={tooltip}>
      {children}
    </span>
  );
}

function badgeTone(status: ProjectSnapshot["status"] | StatusFilter): "neutral" | "clean" | "dirty" | "error" {
  if (status === "clean") return "clean";
  if (status === "dirty") return "dirty";
  if (status === "missing" || status === "error") return "error";
  return "neutral";
}

function labelStatus(status: ProjectSnapshot["status"] | StatusFilter) {
  if (status === "all") return "All";
  if (status === "clean") return "Clean";
  if (status === "dirty") return "Dirty";
  if (status === "missing") return "Missing";
  return "Error";
}

function viewTitle(view: SidebarView, tagFilter: string | null) {
  if (tagFilter) return tagFilter;
  if (view === "health") return "Health";
  if (view === "activity") return "Activity";
  if (view === "worktrees") return "Worktrees";
  if (view === "registry") return "Registry";
  return "Projects";
}

function viewSubtitle(view: SidebarView) {
  if (view === "health") return "Actionable local project health across worktrees, services, and cleanup.";
  if (view === "activity") return "Recent operations performed through this console.";
  if (view === "worktrees") return "Registered repositories grouped by local worktree activity.";
  if (view === "registry") return "Manage registered repositories and remove entries you no longer track.";
  return "Registered repositories, local branches, and worktree activity.";
}

function severityLabel(severity: HealthIssue["severity"]) {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  return "Info";
}

function healthTargetLabel(issue: HealthIssue, projects: ProjectSnapshot[]) {
  const project = projects.find((candidate) => candidate.id === issue.projectId);

  if (issue.targetType === "service" && issue.target) {
    return project?.services.find((service) => service.id === issue.target)?.name ?? issue.target;
  }

  if (issue.targetType === "project") return issue.projectPath;
  return issue.target ?? issue.projectPath;
}

function activityActionLabel(actionName: string) {
  const labels: Record<string, string> = {
    "branch.delete": "Branch",
    "project.add": "Project",
    "project.remove": "Project",
    "project.update": "Project",
    "service.add": "Service",
    "service-group.add": "Service Group",
    "service-group.remove": "Service Group",
    "service-group.restart": "Service Group",
    "service-group.start": "Service Group",
    "service-group.stop": "Service Group",
    "service-group.update": "Service Group",
    "service.remove": "Service",
    "service.restart": "Service",
    "service.start": "Service",
    "service.stop": "Service",
    "worktree.remove": "Worktree"
  };
  return labels[actionName] ?? "Action";
}

function activityTargetLabel(targetType: ActivityEvent["targetType"]) {
  if (targetType === "branch") return "branch";
  if (targetType === "service") return "service";
  if (targetType === "service-group") return "service group";
  if (targetType === "worktree") return "worktree";
  return "project";
}

function formatActivityTime(isoTime: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(isoTime));
}

function formatActivityFullTime(isoTime: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(isoTime));
}

function action(event: React.MouseEvent, callback: () => void) {
  event.stopPropagation();
  callback();
}

function hasTextSelectionInside(element: HTMLElement) {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selectionHasText(selection)) {
    return false;
  }

  const { anchorNode, focusNode } = selection;
  return Boolean((anchorNode && element.contains(anchorNode)) || (focusNode && element.contains(focusNode)));
}

function selectionHasText(selection: Selection) {
  if (selection.toString().trim().length > 0) {
    return true;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).toString().trim().length > 0) {
      return true;
    }
  }

  return false;
}

function startInspectorResize(
  event: PointerEvent<HTMLButtonElement>,
  setInspectorWidth: (value: number | ((current: number) => number)) => void
) {
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);

  function handlePointerMove(moveEvent: globalThis.PointerEvent) {
    const nextWidth = window.innerWidth - moveEvent.clientX;
    setInspectorWidth(Math.min(900, Math.max(340, nextWidth)));
  }

  function handlePointerUp() {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp, { once: true });
}

function changeTone(code: string) {
  if (code.includes("?")) return "new";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  return "modified";
}

function removalTone(level: RemovalAssessment["level"] | undefined): "neutral" | "clean" | "dirty" | "error" {
  if (level === "safe") return "clean";
  if (level === "review") return "dirty";
  if (level === "blocked") return "error";
  return "neutral";
}

function removalTooltip(removal: RemovalAssessment | undefined) {
  if (!removal) return "No safety assessment was available for this item.";
  const scope =
    removal.level === "safe"
      ? "Safe action"
      : removal.level === "review"
        ? "Needs review"
        : "Blocked";
  return `${scope}. ${removal.reasons.join(" ")}`;
}

function branchMetaLabel(branch: BranchInfo) {
  const state = branch.current ? "current" : branch.merged ? "merged" : "unmerged";
  return `${state}${branch.usedByWorktree ? " · in worktree" : ""}`;
}

function branchMetaTooltip(branch: BranchInfo) {
  const details = [
    branch.current
      ? "This is the currently checked-out branch in the registered project."
      : branch.merged
        ? "Git reports this branch is merged into the current HEAD."
        : "Git reports this branch is not merged into the current HEAD.",
    branch.usedByWorktree ? "A local worktree is using it, so branch deletion is blocked." : "No registered worktree is using it."
  ];
  return details.join(" ");
}

function branchTrackingLabel(branch: BranchInfo) {
  if (branch.upstreamGone) {
    return branch.upstream ? `upstream ${branch.upstream} · gone` : "upstream gone";
  }
  if (!branch.upstream) return null;

  const parts = [`upstream ${branch.upstream}`];
  if ((branch.ahead ?? 0) > 0) parts.push(`ahead ${branch.ahead}`);
  if ((branch.behind ?? 0) > 0) parts.push(`behind ${branch.behind}`);
  return parts.join(" · ");
}

function branchTrackingTooltip(branch: BranchInfo) {
  if (branch.upstreamGone) {
    return branch.upstream
      ? `Configured upstream ${branch.upstream} no longer exists.`
      : "The configured upstream no longer exists.";
  }
  if (!branch.upstream) return "No upstream branch is configured.";

  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  if (ahead === 0 && behind === 0) {
    return `Tracks ${branch.upstream}. Git did not report any ahead or behind commits.`;
  }

  const parts = [`Tracks ${branch.upstream}.`];
  if (ahead > 0) parts.push(`${ahead} commit(s) ahead of upstream.`);
  if (behind > 0) parts.push(`${behind} commit(s) behind upstream.`);
  return parts.join(" ");
}

function worktreeChangeTooltip(worktree: WorktreeInfo) {
  if (worktree.clean) return "No local uncommitted changes were reported for this worktree.";
  return `${worktree.dirtyFiles ?? 0} changed file(s). Click this worktree to open the changes panel.`;
}

function worktreeKindTooltip(worktree: WorktreeInfo) {
  if (worktree.detached) return "Detached HEAD worktree: it is checked out at a commit instead of a branch name.";
  return "Branch worktree: this worktree is attached to a local branch.";
}

function worktreeOriginTooltip(worktree: WorktreeInfo) {
  if (worktree.branch) return `This worktree is checked out on ${worktree.branch}${worktree.shortHead ? ` at ${worktree.shortHead}` : ""}.`;
  if ((worktree.baseRefs ?? []).length > 0) {
    return `Detached worktree. Git says this commit is contained by: ${worktree.baseRefs?.join(", ")}.`;
  }
  return worktree.shortHead ? `Detached worktree at commit ${worktree.shortHead}.` : "Detached worktree with no branch metadata.";
}

function serviceStatusTooltip(service: ServiceSnapshot) {
  if (service.status === "running") {
    return service.startedByConsole
      ? "This service was started from this console and is currently running."
      : service.processOwnership === "project"
        ? "The configured health check or port says this service is running outside this console, and its process tree matches this project."
        : "The configured health check or port says this service is already running outside this console.";
  }
  if (service.status === "port-occupied") {
    return service.processOwnership === "project"
      ? "A configured port is already listening, and the listening process is matched to this project."
      : "A configured port is already listening, but this console did not start or recognize that process.";
  }
  if (service.status === "starting") return "The console started the process, but the health check is not passing yet.";
  if (service.status === "error") return "The service check reported an error.";
  if (service.ports.length === 0 && !service.healthUrl) return "One-shot task. It is ready to run and does not keep a port open.";
  return "No configured port or health check is currently active.";
}

function serviceKindTooltip(service: ServiceSnapshot) {
  if (service.ports.length === 0 && !service.healthUrl) return "Task mode: click Run to execute it once; Stop and Restart are hidden.";
  if (service.startedByConsole) return "Console-managed process: Stop and Restart are available here.";
  if (service.processOwnership === "none") return "Registered long-running service. Start is available when its configured ports are free.";
  if (service.processOwnership === "project") {
    return service.processOwnerHint
      ? `External process matched to this project. ${service.processOwnerHint} Stop is available after confirmation.`
      : "External process matched to this project. Stop is available after confirmation.";
  }
  return "Unknown external process: the console can detect it, but Stop is disabled because the process tree was not matched to this project.";
}

function portTooltip(port: ServiceSnapshot["portsStatus"][number]) {
  if (port.listening) return `Port ${port.port} is listening${port.pid ? ` on PID ${port.pid}` : ""}.`;
  return `Port ${port.port} is free.`;
}

function worktreeOriginLabel(worktree: ProjectSnapshot["worktrees"][number]) {
  if (worktree.branch) {
    return worktree.shortHead ? `branch ${worktree.branch} at ${worktree.shortHead}` : `branch ${worktree.branch}`;
  }

  const candidateBranches = (worktree.baseRefs ?? []).slice(0, 2);
  if (candidateBranches.length > 0) {
    const more = (worktree.baseRefs?.length ?? 0) > candidateBranches.length ? " +" : "";
    return `detached from ${candidateBranches.join(", ")}${more}`;
  }

  return worktree.shortHead ? `detached at ${worktree.shortHead}` : "detached";
}

function commitRangeLabel(range: CommitRange) {
  if (range === "24h") return "24h";
  if (range === "7d") return "7d";
  if (range === "30d") return "30d";
  return "All";
}

function gitStatusHasFile(status: GitOperationStatus, filePath: string) {
  return [...status.changes.unstaged, ...status.changes.staged].some((change) => change.path === filePath);
}

function sameGitPath(left: string, right: string) {
  const normalizedLeft = normalizeGitPath(left);
  const normalizedRight = normalizeGitPath(right);
  if (normalizedLeft === normalizedRight) return true;
  if (!isWindowsGitPath(normalizedLeft) && !isWindowsGitPath(normalizedRight)) return false;
  return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}

function normalizeGitPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isWindowsGitPath(path: string) {
  return /^[a-z]:\//i.test(path) || path.startsWith("//");
}

function syncActionLabel(actionName: GitSyncAction) {
  if (actionName === "fetch") return "Fetch";
  if (actionName === "pull") return "Pull";
  return "Push";
}

function syncActionTitle(actionName: GitSyncAction) {
  if (actionName === "fetch") return "Fetch remote refs";
  if (actionName === "pull") return "Pull from upstream";
  return "Push local commits";
}

function syncActionPastTense(actionName: GitSyncAction) {
  if (actionName === "fetch") return "Fetched";
  if (actionName === "pull") return "Pulled";
  return "Pushed";
}

function parsePortInput(input: string) {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    )
  );
}

function confirmTargetLabel(action: ConfirmAction) {
  if (action.type === "worktree") return "Worktree path";
  if (action.type === "branch") return "Branch";
  return "Service";
}

function confirmTargetValue(action: ConfirmAction) {
  if (action.type === "worktree") return action.worktree.path;
  if (action.type === "branch") return action.branch.name;
  return action.service.name;
}
