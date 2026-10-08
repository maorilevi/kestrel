import type { ScannedManifest } from '../scanner/repository-scanner';

/**
 * Prisma schema reader.
 *
 * Prisma keeps the data model outside TypeScript, so a repository using Prisma
 * has no `@Entity` classes and its data layer would look empty. This parser
 * gives those models the same standing as decorated entities.
 *
 * It is a block parser, not a regex sweep: the file is scanned line by line
 * with brace depth tracked, so a stray `model` inside a comment or a string
 * cannot invent a node.
 */

export interface PrismaRelation {
  /** Model on the other side of the relation. */
  targetModel: string;
  /** Field declaring the relation. */
  fieldName: string;
  isList: boolean;
  /** True when this side holds the foreign key (`@relation(fields: [...])`). */
  ownsForeignKey: boolean;
}

export interface PrismaModelDefinition {
  name: string;
  /** Workspace relative path of the schema. */
  filePath: string;
  /** Directory the schema serves (`apps/api` for `apps/api/prisma/schema.prisma`). */
  scope: string;
  /** 1-based line of the `model` keyword. */
  line: number;
  scalarFieldCount: number;
  relations: PrismaRelation[];
  /** Table name declared with `@@map("users")`. */
  tableName?: string;
}

export class PrismaParser {
  /** Parses every `schema.prisma` found among the scanned manifests. */
  parse(manifests: readonly ScannedManifest[]): PrismaModelDefinition[] {
    const models: PrismaModelDefinition[] = [];

    for (const manifest of manifests) {
      if (!manifest.relativePath.endsWith('schema.prisma')) {
        continue;
      }
      try {
        models.push(...parseSchema(manifest.content, manifest.relativePath));
      } catch {
        // A malformed schema must never take the whole architecture down.
      }
    }

    return models;
  }
}

interface RawBlock {
  keyword: string;
  name: string;
  line: number;
  body: string[];
}

function parseSchema(content: string, filePath: string): PrismaModelDefinition[] {
  const blocks = readBlocks(content);
  const modelNames = new Set(
    blocks.filter((block) => block.keyword === 'model' || block.keyword === 'type').map((b) => b.name),
  );

  return blocks
    .filter((block) => block.keyword === 'model')
    .map((block) => readModel(block, modelNames, filePath));
}

/** Splits the schema into top level `<keyword> <Name> { ... }` blocks. */
function readBlocks(content: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const lines = content.split(/\r?\n/);

  let current: RawBlock | undefined;
  let depth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    if (line.trim().length === 0) {
      continue;
    }

    if (!current) {
      const header = /^\s*(model|enum|type|view|datasource|generator)\s+([A-Za-z_][\w]*)\s*\{/.exec(line);
      if (header) {
        current = { keyword: header[1], name: header[2], line: index + 1, body: [] };
        depth = countBraces(line);
        if (depth === 0) {
          blocks.push(current);
          current = undefined;
        }
      }
      continue;
    }

    depth += countBraces(line);
    if (depth <= 0) {
      blocks.push(current);
      current = undefined;
      continue;
    }
    current.body.push(line);
  }

  return blocks;
}

function readModel(block: RawBlock, modelNames: ReadonlySet<string>, filePath: string): PrismaModelDefinition {
  const relations: PrismaRelation[] = [];
  let scalarFieldCount = 0;
  let tableName: string | undefined;

  for (const line of block.body) {
    const trimmed = line.trim();

    if (trimmed.startsWith('@@')) {
      tableName = /@@map\(\s*"([^"]+)"/.exec(trimmed)?.[1] ?? tableName;
      continue;
    }

    const field = /^([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)(\[\])?(\?)?(.*)$/.exec(trimmed);
    if (!field) {
      continue;
    }

    const [, fieldName, typeName, list, , rest] = field;

    if (modelNames.has(typeName)) {
      relations.push({
        targetModel: typeName,
        fieldName,
        isList: list === '[]',
        ownsForeignKey: /@relation\([^)]*\bfields\s*:/.test(rest),
      });
    } else {
      scalarFieldCount += 1;
    }
  }

  const directory = dirname(filePath);

  return {
    name: block.name,
    filePath,
    scope: basename(directory) === 'prisma' ? dirname(directory) : directory,
    line: block.line,
    scalarFieldCount,
    relations,
    tableName,
  };
}

/**
 * Prisma client delegates are the model name with a lower-cased first letter
 * (`TraceSpan` → `prisma.traceSpan`). This is how a call site is mapped back to
 * the model it touches.
 */
export function delegateName(modelName: string): string {
  return modelName.length === 0 ? modelName : modelName[0].toLowerCase() + modelName.slice(1);
}

function stripComment(line: string): string {
  const index = line.indexOf('//');
  return index === -1 ? line : line.slice(0, index);
}

function countBraces(line: string): number {
  let depth = 0;
  for (const character of line) {
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
  }
  return depth;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

function basename(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}
