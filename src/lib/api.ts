import type {
  ActivityEvent,
  ActivityResponse,
  DashboardResponse,
  GitOperationResponse,
  GitOperationStatus,
  RecentCommit,
  RegisteredProject,
  RegisteredService,
  RegisteredServiceGroup,
  ServiceGroupActionResponse,
  ServiceSnapshot,
  WorktreeDiffResponse
} from "../shared/types";

export type AddProjectPayload = {
  name?: string;
  path: string;
  tags?: string[];
};

export type AddServicePayload = {
  name: string;
  cwd: string;
  command: string;
  ports: number[];
  healthUrl?: string | null;
};

export type AddServiceGroupPayload = {
  name: string;
  serviceIds: string[];
};

export type UpdateServiceGroupPayload = Partial<AddServiceGroupPayload>;

export async function getDashboard(): Promise<DashboardResponse> {
  return request<DashboardResponse>("/api/projects");
}

export async function getActivity(limit = 100): Promise<ActivityEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return (await request<ActivityResponse>(`/api/activity?${params.toString()}`)).events;
}

export async function selectFolder(): Promise<string | null> {
  const response = await request<{ path: string | null }>("/api/system/select-folder", { method: "POST" });
  return response.path;
}

export async function addProject(payload: AddProjectPayload): Promise<RegisteredProject> {
  return request<RegisteredProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function removeProject(id: string): Promise<void> {
  await request<void>(`/api/projects/${id}`, { method: "DELETE" });
}

export async function updateProjectName(id: string, name: string): Promise<RegisteredProject> {
  return request<RegisteredProject>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name })
  });
}

export async function openProjectFolder(id: string): Promise<void> {
  await request<void>(`/api/projects/${id}/open-folder`, { method: "POST" });
}

export async function openProjectTerminal(id: string): Promise<void> {
  await request<void>(`/api/projects/${id}/open-terminal`, { method: "POST" });
}

export async function deleteWorktree(projectId: string, path: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/worktrees`, {
    method: "DELETE",
    body: JSON.stringify({ path })
  });
}

export async function getWorktreeDiff(
  projectId: string,
  worktreePath: string,
  filePath: string
): Promise<WorktreeDiffResponse> {
  const params = new URLSearchParams({ path: worktreePath, file: filePath });
  return request<WorktreeDiffResponse>(`/api/projects/${projectId}/worktrees/diff?${params.toString()}`);
}

export async function getGitStatus(projectId: string, worktreePath: string): Promise<GitOperationStatus> {
  const params = new URLSearchParams({ path: worktreePath });
  return request<GitOperationStatus>(`/api/projects/${projectId}/git/status?${params.toString()}`);
}

export async function runGitOperation(
  projectId: string,
  action: "fetch" | "pull" | "push" | "stage" | "unstage" | "commit" | "stash",
  body: Record<string, unknown>
): Promise<GitOperationResponse> {
  return request<GitOperationResponse>(`/api/projects/${projectId}/git/${action}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function deleteBranch(projectId: string, branch: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/branches/${encodeURIComponent(branch)}`, {
    method: "DELETE"
  });
}

export async function getProjectCommits(projectId: string, options: { limit: number; range: string }): Promise<RecentCommit[]> {
  const params = new URLSearchParams({
    limit: String(options.limit),
    range: options.range
  });
  return request<RecentCommit[]>(`/api/projects/${projectId}/commits?${params.toString()}`);
}

export async function addService(projectId: string, payload: AddServicePayload): Promise<RegisteredService> {
  return request<RegisteredService>(`/api/projects/${projectId}/services`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function removeService(projectId: string, serviceId: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/services/${serviceId}`, { method: "DELETE" });
}

export async function addServiceGroup(
  projectId: string,
  payload: AddServiceGroupPayload
): Promise<RegisteredServiceGroup> {
  return request<RegisteredServiceGroup>(`/api/projects/${projectId}/service-groups`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateServiceGroup(
  projectId: string,
  groupId: string,
  payload: UpdateServiceGroupPayload
): Promise<RegisteredServiceGroup> {
  return request<RegisteredServiceGroup>(`/api/projects/${projectId}/service-groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function removeServiceGroup(projectId: string, groupId: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/service-groups/${groupId}`, { method: "DELETE" });
}

export async function startServiceGroup(projectId: string, groupId: string): Promise<ServiceGroupActionResponse> {
  return request<ServiceGroupActionResponse>(`/api/projects/${projectId}/service-groups/${groupId}/start`, {
    method: "POST"
  });
}

export async function stopServiceGroup(projectId: string, groupId: string): Promise<ServiceGroupActionResponse> {
  return request<ServiceGroupActionResponse>(`/api/projects/${projectId}/service-groups/${groupId}/stop`, {
    method: "POST"
  });
}

export async function restartServiceGroup(projectId: string, groupId: string): Promise<ServiceGroupActionResponse> {
  return request<ServiceGroupActionResponse>(`/api/projects/${projectId}/service-groups/${groupId}/restart`, {
    method: "POST"
  });
}

export async function startService(projectId: string, serviceId: string): Promise<ServiceSnapshot> {
  return request<ServiceSnapshot>(`/api/projects/${projectId}/services/${serviceId}/start`, { method: "POST" });
}

export async function stopService(projectId: string, serviceId: string): Promise<ServiceSnapshot> {
  return request<ServiceSnapshot>(`/api/projects/${projectId}/services/${serviceId}/stop`, { method: "POST" });
}

export async function restartService(projectId: string, serviceId: string): Promise<ServiceSnapshot> {
  return request<ServiceSnapshot>(`/api/projects/${projectId}/services/${serviceId}/restart`, { method: "POST" });
}

export async function getServiceLogs(projectId: string, serviceId: string): Promise<string[]> {
  const payload = await request<{ lines: string[] }>(`/api/projects/${projectId}/services/${serviceId}/logs`);
  return payload.lines;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    ...init
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
