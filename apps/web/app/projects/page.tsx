'use client';

import type { ProjectSummary } from '@kestrel/protocol';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { StatusPill } from '@/components/StatusPill';
import { useRequiredSession } from '@/components/useSession';
import { ensureActiveOrganization } from '@/lib/auth-client';
import { api } from '@/lib/api';

function ProjectsView() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useRequiredSession();
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<'template' | 'github' | undefined>(
    params.get('new') === 'github' ? 'github' : undefined,
  );

  const load = useCallback(async () => {
    try {
      setProjects(await api.projects());
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => {
    if (session.data) {
      void ensureActiveOrganization(session.data.user.name).then(load);
    }
  }, [session.data, load]);

  if (!session.data) {
    return null;
  }

  return (
    <>
      <AppHeader userName={session.data.user.name} onOrganizationChange={() => void load()} />
      <main className="page">
        <div className="page__head">
          <h1>Projects</h1>
          <button className="btn btn--primary" onClick={() => setDialog('template')}>
            New project
          </button>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        {projects && projects.length === 0 ? (
          <div className="empty">
            <h2>No projects yet</h2>
            <p>Start from a template, or bring a repository you already have.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn--primary" onClick={() => setDialog('template')}>
                Start from a template
              </button>
              <button className="btn" onClick={() => setDialog('github')}>
                Import from GitHub
              </button>
            </div>
          </div>
        ) : null}

        <div className="project-grid">
          {(projects ?? []).map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="project-card">
              <span className="project-card__name">{project.name}</span>
              <StatusPill status={project.status} />
              <span className="project-card__meta">
                <span>{project.source.kind === 'github' ? project.source.repoUrl.replace('https://github.com/', '') : 'Template'}</span>
                <span>{new Date(project.createdAt).toLocaleDateString()}</span>
              </span>
            </Link>
          ))}
        </div>
      </main>

      {dialog ? (
        <NewProjectDialog
          initialMode={dialog}
          onClose={() => setDialog(undefined)}
          onCreated={(project) => router.push(`/projects/${project.id}`)}
        />
      ) : null}
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}
