'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient, organizationSlug } from '@/lib/auth-client';

import { Brand } from './Brand';

const NEW_TEAM = '__new__';

/** Brand, organization switcher (personal workspace or team) and the user menu. */
export function AppHeader({ userName, onOrganizationChange }: { userName: string; onOrganizationChange(): void }) {
  const router = useRouter();
  const organizations = authClient.useListOrganizations();
  const active = authClient.useActiveOrganization();
  const [creating, setCreating] = useState(false);

  const select = async (value: string) => {
    if (value === NEW_TEAM) {
      setCreating(true);
      return;
    }
    await authClient.organization.setActive({ organizationId: value });
    onOrganizationChange();
  };

  const createTeam = async (name: string) => {
    const created = await authClient.organization.create({ name, slug: organizationSlug(name) });
    if (created.data) {
      await authClient.organization.setActive({ organizationId: created.data.id });
      setCreating(false);
      onOrganizationChange();
    }
  };

  return (
    <header className="app-header">
      <Brand href="/projects" />
      <select
        className="org-switcher"
        aria-label="Organization"
        value={active.data?.id ?? ''}
        onChange={(event) => void select(event.target.value)}
      >
        {(organizations.data ?? []).map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
        <option value={NEW_TEAM}>+ New team…</option>
      </select>
      {creating ? <NewTeamForm onCreate={createTeam} onCancel={() => setCreating(false)} /> : null}
      <div className="app-header__spacer" />
      <span className="app-header__user">{userName}</span>
      <button
        className="btn btn--ghost btn--small"
        onClick={async () => {
          await authClient.signOut();
          router.push('/');
        }}
      >
        Sign out
      </button>
    </header>
  );
}

function NewTeamForm({ onCreate, onCancel }: { onCreate(name: string): Promise<void>; onCancel(): void }) {
  const [name, setName] = useState('');
  return (
    <form
      style={{ display: 'flex', gap: 6 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) {
          void onCreate(name.trim());
        }
      }}
    >
      <input
        className="input"
        style={{ height: 32 }}
        autoFocus
        placeholder="Team name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button className="btn btn--small btn--primary" type="submit">
        Create
      </button>
      <button className="btn btn--small btn--ghost" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
