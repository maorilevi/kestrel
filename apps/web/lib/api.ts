import type { ProjectSource, ProjectSummary } from '@kestrel/protocol';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? `${response.status} ${response.statusText}`);
  }
  return body as T;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export const api = {
  templates: () => request<{ templates: TemplateInfo[] }>('/api/templates').then((body) => body.templates),
  projects: () => request<{ projects: ProjectSummary[] }>('/api/projects').then((body) => body.projects),
  project: (id: string) => request<{ project: ProjectSummary }>(`/api/projects/${id}`).then((body) => body.project),
  createProject: (name: string, source: ProjectSource) =>
    request<{ project: ProjectSummary }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, source }),
    }).then((body) => body.project),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  channelTicket: (id: string) =>
    request<{ ticket: string }>(`/api/projects/${id}/channel`, { method: 'POST' }).then((body) => body.ticket),
};
