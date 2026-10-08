import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { SandboxFile } from '@kestrel/sandbox';

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

/** Templates offered when a project starts from scratch. */
export const TEMPLATES: readonly TemplateInfo[] = [
  {
    id: 'fullstack-starter',
    name: 'Fullstack starter',
    description: 'NestJS API and a React web app, wired together through /api.',
  },
];

const SKIPPED = new Set(['node_modules', 'dist', '.git']);

export function isKnownTemplate(id: string): boolean {
  return TEMPLATES.some((template) => template.id === id);
}

/** Reads a template folder into the files a sandbox is seeded with. */
export async function readTemplate(repoRoot: string, id: string): Promise<SandboxFile[]> {
  if (!isKnownTemplate(id)) {
    throw new Error(`Unknown template "${id}".`);
  }
  const root = path.join(repoRoot, 'templates', id);
  const files: SandboxFile[] = [];

  const walk = async (relativeDir: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(root, relativeDir), { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) {
        continue;
      }
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else if (entry.isFile()) {
        files.push({ path: relativePath, content: await fs.readFile(path.join(root, relativePath)) });
      }
    }
  };

  await walk('');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** Accepts `https://github.com/owner/repo` (optionally `.git` or a trailing slash). */
export function parseGitHubUrl(value: string): { owner: string; repo: string; cloneUrl: string } | undefined {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, owner, repo] = match;
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}
