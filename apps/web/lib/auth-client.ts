'use client';

import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Talks to `/api/auth`, which Next rewrites to the control plane. */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'workspace';
}

/** A unique slug: organizations are global, display names are not. */
export function organizationSlug(name: string): string {
  return `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Every project lives in an organization. A founder who just signed up gets a
 * personal one; anyone else lands in the first organization they belong to.
 */
export async function ensureActiveOrganization(userName: string): Promise<string | undefined> {
  const session = await authClient.getSession();
  const active = (session.data?.session as { activeOrganizationId?: string | null } | undefined)?.activeOrganizationId;
  if (active) {
    return active;
  }

  const organizations = await authClient.organization.list();
  let organizationId = organizations.data?.[0]?.id;
  if (!organizationId) {
    const name = `${userName}'s workspace`;
    const created = await authClient.organization.create({ name, slug: organizationSlug(userName) });
    organizationId = created.data?.id;
  }
  if (organizationId) {
    await authClient.organization.setActive({ organizationId });
  }
  return organizationId;
}
