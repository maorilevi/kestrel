import { randomUUID } from 'node:crypto';

import type { ProjectSource, ProjectStatus, ProjectSummary } from '@kestrel/protocol';

import type { DatabaseHandle, ProjectTable } from '../db';

export interface ProjectRecord extends ProjectSummary {
  sandboxProvider?: string;
  sandboxId?: string;
  createdBy: string;
}

function toRecord(row: ProjectTable): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organization_id,
    source: JSON.parse(row.source) as ProjectSource,
    status: row.status as ProjectStatus,
    previewUrl: row.preview_url ?? undefined,
    sandboxProvider: row.sandbox_provider ?? undefined,
    sandboxId: row.sandbox_id ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** The public shape: sandbox details stay on the server. */
export function toSummary(record: ProjectRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    organizationId: record.organizationId,
    source: record.source,
    status: record.status,
    previewUrl: record.previewUrl,
    createdAt: record.createdAt,
  };
}

export class ProjectStore {
  constructor(private readonly database: DatabaseHandle) {}

  async create(input: {
    organizationId: string;
    name: string;
    source: ProjectSource;
    createdBy: string;
  }): Promise<ProjectRecord> {
    const row: ProjectTable = {
      id: randomUUID(),
      organization_id: input.organizationId,
      name: input.name,
      source: JSON.stringify(input.source),
      status: 'idle',
      sandbox_provider: null,
      sandbox_id: null,
      preview_url: null,
      created_by: input.createdBy,
      created_at: new Date().toISOString(),
    };
    await this.database.db.insertInto('project').values(row).execute();
    return toRecord(row);
  }

  async get(id: string): Promise<ProjectRecord | undefined> {
    const row = await this.database.db.selectFrom('project').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async listForOrganization(organizationId: string): Promise<ProjectRecord[]> {
    const rows = await this.database.db
      .selectFrom('project')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(toRecord);
  }

  async update(
    id: string,
    patch: Partial<{
      status: ProjectStatus;
      previewUrl: string | null;
      sandboxProvider: string | null;
      sandboxId: string | null;
      name: string;
    }>,
  ): Promise<void> {
    const values: Partial<ProjectTable> = {};
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.previewUrl !== undefined) values.preview_url = patch.previewUrl;
    if (patch.sandboxProvider !== undefined) values.sandbox_provider = patch.sandboxProvider;
    if (patch.sandboxId !== undefined) values.sandbox_id = patch.sandboxId;
    if (patch.name !== undefined) values.name = patch.name;
    if (Object.keys(values).length === 0) {
      return;
    }
    await this.database.db.updateTable('project').set(values).where('id', '=', id).execute();
  }

  async delete(id: string): Promise<void> {
    await this.database.db.deleteFrom('project').where('id', '=', id).execute();
  }
}
