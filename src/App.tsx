import { FormEvent, useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  ListTree,
  Play,
  Plus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2
} from "lucide-react";

import {
  addProject,
  addService,
  deleteBranch,
  deleteWorktree,
  getDashboard,
  getProjectCommits,
  getServiceLogs,
  openProjectFolder,
  openProjectTerminal,
  removeProject,
  removeService,
  restartService,
  selectFolder,
  startService,
  stopService,
  updateProjectName
} from "./lib/api";
import {
  serviceKindLabel,
  servicePortLabel,
  servicePrimaryActionLabel,
  serviceShowProcessControls,
  serviceStatusLabel,
  serviceStatusTone,
  serviceUrl
} from "./lib/service-ui";
import type {
  BranchInfo,
  DashboardResponse,
  ProjectSnapshot,
  RecentCommit,
  RemovalAssessment,
  ServiceSnapshot,
  WorktreeInfo
} from "./shared/types";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { SegmentedControl, SegmentButton } from "./components/ui/tabs";

type StatusFilter = "all" | "clean" | "dirty" | "missing";
type SidebarView = "projects" | "worktrees" | "registry";
type InspectorTab = "trees" | "branches" | "commits" | "services";
type CommitRange = "24h" | "7d" | "30d" | "all";

const emptyDashboard: DashboardResponse = {
  projects: [],
  summary: { projects: 0, worktrees: 0, services: 0, runningServices: 0, dirty: 0, missing: 0, clean: 0 }
};

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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(640);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const nextDashboard = await getDashboard();
      setDashboard(nextDashboard);
      setSelectedId((current) => current ?? nextDashboard.projects[0]?.id ?? null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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
    await refresh();
  }

  function handleViewChange(nextView: SidebarView) {
    setView(nextView);
    setTagFilter(null);
    if (nextView === "worktrees") {
      setFilter("all");
    }
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
          <Button aria-label="Refresh" disabled={loading} size="icon" onClick={() => void refresh()}>
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
            {selectedProject ? (
              <Button onClick={() => void handleOpenFolder(selectedProject)}>
                <FolderOpen size={15} />
                Open Folder
              </Button>
            ) : null}
          </div>

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

          <StatusStrip dashboard={dashboard} />

          {error ? <div className="error-banner">{error}</div> : null}
          {notice ? (
            <div className="notice-banner">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)}>Dismiss</button>
            </div>
          ) : null}

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
        </main>

        <Inspector
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
          onResizeStart={(event) => startInspectorResize(event, setInspectorWidth)}
          onServiceChanged={async (message) => {
            setNotice(message);
            await refresh();
          }}
          onTabChange={setInspectorTab}
        />
      </div>

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={async () => {
          setDialogOpen(false);
          await refresh();
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
          await refresh();
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
          await refresh();
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
          await refresh();
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
  onAddService,
  onDeleteBranch,
  onDeleteService,
  onDeleteWorktree,
  onEditProject,
  onResizeStart,
  onServiceChanged,
  onTabChange,
  project,
  tab
}: {
  project: ProjectSnapshot | null;
  tab: InspectorTab;
  onAddService: (project: ProjectSnapshot) => void;
  onDeleteBranch: (project: ProjectSnapshot, branch: BranchInfo) => void;
  onDeleteService: (project: ProjectSnapshot, service: ServiceSnapshot) => void;
  onDeleteWorktree: (project: ProjectSnapshot, worktree: WorktreeInfo) => void;
  onEditProject: (project: ProjectSnapshot) => void;
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
  onServiceChanged: (message: string) => Promise<void>;
  onTabChange: (tab: InspectorTab) => void;
}) {
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
      </SegmentedControl>

      {project.error ? <div className="error-banner compact">{project.error}</div> : null}

      {tab === "trees" ? <WorktreePanel project={project} onDeleteWorktree={onDeleteWorktree} /> : null}
      {tab === "branches" ? <BranchPanel project={project} onDeleteBranch={onDeleteBranch} /> : null}
      {tab === "commits" ? <CommitPanel project={project} /> : null}
      {tab === "services" ? (
        <ServicePanel
          project={project}
          onAddService={onAddService}
          onDeleteService={onDeleteService}
          onServiceChanged={onServiceChanged}
        />
      ) : null}
    </aside>
  );
}

function WorktreePanel({
  onDeleteWorktree,
  project
}: {
  project: ProjectSnapshot;
  onDeleteWorktree: (project: ProjectSnapshot, worktree: WorktreeInfo) => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedWorktree =
    project.worktrees.find((worktree) => worktree.path === selectedPath) ?? null;

  useEffect(() => {
    setSelectedPath(null);
  }, [project.id]);

  return (
    <section className={`section worktree-panel ${selectedWorktree ? "with-changes" : ""}`}>
      <div className="worktree-list-pane">
        <h3>Worktrees</h3>
        <div className="tree">
          {project.worktrees.length === 0 ? (
            <div className="empty-state compact">No worktrees found.</div>
          ) : (
            project.worktrees.map((worktree) => (
              <div
                className={`tree-item tree-button ${selectedWorktree?.path === worktree.path ? "active" : ""}`}
                key={`${worktree.path}-${worktree.head}`}
                onClick={() => setSelectedPath(selectedWorktree?.path === worktree.path ? null : worktree.path)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedPath(selectedWorktree?.path === worktree.path ? null : worktree.path);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="tree-top">
                  <strong>{worktree.branch ?? "detached"}</strong>
                  <span className="tree-badges">
                    <Badge tone={worktree.clean ? "clean" : "dirty"}>
                      {worktree.clean ? "Clean" : `${worktree.dirtyFiles ?? 0} changed`}
                    </Badge>
                    <Badge tone={removalTone(worktree.removal?.level)}>{worktree.removal?.label ?? "Unknown"}</Badge>
                    <Badge>{worktree.detached ? "Detached" : "Branch"}</Badge>
                  </span>
                </div>
                <span className="worktree-origin">{worktreeOriginLabel(worktree)}</span>
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
      {selectedWorktree ? <WorktreeChanges onClose={() => setSelectedPath(null)} worktree={selectedWorktree} /> : null}
    </section>
  );
}

function WorktreeChanges({
  onClose,
  worktree
}: {
  onClose: () => void;
  worktree: NonNullable<ProjectSnapshot["worktrees"][number]>;
}) {
  const changes = worktree.changes ?? [];

  return (
    <section className="worktree-detail">
      <div className="detail-heading">
        <div>
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
        <div className="change-list">
          {changes.map((change) => (
            <div className="change-row" key={`${change.code}-${change.path}`}>
              <span className={`change-code ${changeTone(change.code)}`}>{change.code}</span>
              <span className="mono">{change.path}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BranchPanel({
  onDeleteBranch,
  project
}: {
  project: ProjectSnapshot;
  onDeleteBranch: (project: ProjectSnapshot, branch: BranchInfo) => void;
}) {
  return (
    <section className="section">
      <h3>Branches</h3>
      <div className="branch-list">
        {project.branches.length === 0 ? (
          <div className="empty-state compact">No branches available.</div>
        ) : (
          project.branches.map((branch) => (
            <div className="branch-row" key={branch.name}>
              <div className="branch-main">
                <strong>{branch.name}</strong>
                <span className="branch-meta">
                  {branch.current ? "current" : branch.merged ? "merged" : "unmerged"}
                  {branch.usedByWorktree ? " · in worktree" : ""}
                </span>
              </div>
              <span className="branch-actions">
                <Badge tone={removalTone(branch.removal.level)}>{branch.removal.label}</Badge>
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
          ))
        )}
      </div>
    </section>
  );
}

function CommitPanel({ project }: { project: ProjectSnapshot }) {
  const [limit, setLimit] = useState(5);
  const [range, setRange] = useState<CommitRange>("all");
  const [commits, setCommits] = useState<RecentCommit[]>(project.recentCommits);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getProjectCommits(project.id, { limit, range })
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
  }, [project.id, limit, range]);

  return (
    <section className="section">
      <div className="commit-heading">
        <h3>Recent Commits</h3>
        <span className="mono">main worktree</span>
      </div>
      <div className="commit-controls">
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
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  async function runServiceAction(service: ServiceSnapshot, actionName: "start" | "stop" | "restart") {
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
        <Button onClick={() => onAddService(project)}>
          <Plus size={14} />
          Add Service
        </Button>
      </div>
      {error ? <div className="error-banner compact">{error}</div> : null}
      {project.services.length === 0 ? (
        <div className="empty-state compact">No services registered for this project.</div>
      ) : (
        <div className="service-list">
          {project.services.map((service) => {
            const busy = busyServiceId === service.id;
            const url = serviceUrl(service);
            const lines = logLines[service.id] ?? service.logPreview;
            return (
              <article className="service-card" key={service.id}>
                <div className="service-top">
                  <div className="service-title-row">
                    <strong>{service.name}</strong>
                    <span className="service-badges">
                      <Badge tone={serviceStatusTone(service)}>{serviceStatusLabel(service)}</Badge>
                      <Badge tone={service.startedByConsole ? "clean" : "neutral"}>{serviceKindLabel(service)}</Badge>
                    </span>
                  </div>
                  <span className="service-command mono">{service.command}</span>
                </div>

                <div className="service-meta">
                  <span className="service-path mono">{service.cwd}</span>
                  <span className="service-secondary">{servicePortLabel(service)}</span>
                  {service.pid ? <span className="service-secondary">PID {service.pid}</span> : null}
                </div>

                {service.portsStatus.length > 0 ? (
                  <div className="port-list">
                    {service.portsStatus.map((port) => (
                      <span className="port-chip" key={port.port}>
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
                        disabled={busy || !service.startedByConsole}
                        title="Stop"
                        onClick={() => void runServiceAction(service, "stop")}
                      >
                        <Square size={13} />
                        Stop
                      </Button>
                      <Button
                        disabled={busy || !service.startedByConsole}
                        title="Restart"
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
    </section>
  );
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
  if (view === "worktrees") return "Worktrees";
  if (view === "registry") return "Registry";
  return "Projects";
}

function viewSubtitle(view: SidebarView) {
  if (view === "worktrees") return "Registered repositories grouped by local worktree activity.";
  if (view === "registry") return "Manage registered repositories and remove entries you no longer track.";
  return "Registered repositories, local branches, and worktree activity.";
}

function action(event: React.MouseEvent, callback: () => void) {
  event.stopPropagation();
  callback();
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
