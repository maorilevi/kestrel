import type { AgentRunSummary } from '@kestrel/protocol';

import type { AgentRunTable, DatabaseHandle } from '../db';

/** Agent runs per project, kept so a team sees what changed, when and why. */
export class AgentRunStore {
  constructor(private readonly database: DatabaseHandle) {}

  async save(projectId: string, run: AgentRunSummary, startedById: string): Promise<void> {
    const row: AgentRunTable = {
      id: run.id,
      project_id: projectId,
      prompt: run.prompt,
      node_ids: JSON.stringify(run.nodeIds),
      status: run.status,
      summary: run.summary ?? null,
      error: run.error ?? null,
      changed_files: JSON.stringify(run.changedFiles),
      commit_sha: run.commit ?? null,
      architecture: run.architecture ? JSON.stringify(run.architecture) : null,
      transcript: JSON.stringify(run.transcript),
      undone: run.undone ? 1 : 0,
      started_by: startedById,
      started_by_name: run.startedBy,
      created_at: run.startedAt,
    };
    await this.database.db
      .insertInto('agent_run')
      .values(row)
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet({
          status: row.status,
          summary: row.summary,
          error: row.error,
          changed_files: row.changed_files,
          commit_sha: row.commit_sha,
          architecture: row.architecture,
          transcript: row.transcript,
          undone: row.undone,
        }),
      )
      .execute();
  }

  async recent(projectId: string, limit = 20): Promise<AgentRunSummary[]> {
    const rows = await this.database.db
      .selectFrom('agent_run')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      nodeIds: JSON.parse(row.node_ids) as string[],
      status: row.status as AgentRunSummary['status'],
      startedBy: row.started_by_name,
      startedAt: row.created_at,
      summary: row.summary ?? undefined,
      error: row.error ?? undefined,
      changedFiles: JSON.parse(row.changed_files) as string[],
      commit: row.commit_sha ?? undefined,
      architecture: row.architecture ? (JSON.parse(row.architecture) as AgentRunSummary['architecture']) : undefined,
      undone: row.undone === 1,
      transcript: JSON.parse(row.transcript) as AgentRunSummary['transcript'],
    }));
  }

  async deleteForProject(projectId: string): Promise<void> {
    await this.database.db.deleteFrom('agent_run').where('project_id', '=', projectId).execute();
  }
}
