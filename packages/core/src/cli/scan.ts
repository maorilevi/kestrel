import { watch } from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';

import { ArchitectureService } from '../architecture.service';
import type { ArchitectureGraph } from '../models';
import type { Logger } from '../logger';
import { FsRepositoryScanner } from '../scanner/fs-repository-scanner';
import { isIgnoredFile } from '../scanner/repository-scanner';

/**
 * `kestrel-scan <root> [--name <display name>] [--watch] [--exclude <glob>]...`
 *
 * Runs the architecture engine headless and writes newline-delimited JSON to
 * stdout, one event per line:
 *
 *   {"type":"graph","graph":{...}}         a complete architecture graph
 *   {"type":"scanning"}                    a rebuild started
 *   {"type":"log","level":"warn","message":"..."}
 *   {"type":"error","message":"..."}       a build failed; the process keeps watching
 *
 * In watch mode it rebuilds on source changes (debounced) and whenever the
 * line `scan` arrives on stdin. This is the process a sandbox runs next to the
 * user's dev server, so the control plane never needs the code locally.
 */

export type ScanEvent =
  | { type: 'graph'; graph: ArchitectureGraph }
  | { type: 'scanning' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'error'; message: string };

export interface ScanCliOptions {
  root: string;
  name?: string;
  watch: boolean;
  excludes: string[];
  debounceMs: number;
}

export function parseScanArgs(argv: readonly string[]): ScanCliOptions {
  const options: ScanCliOptions = { root: '', watch: false, excludes: [], debounceMs: 500 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--name') {
      options.name = argv[++index];
    } else if (arg === '--exclude') {
      options.excludes.push(argv[++index]);
    } else if (arg === '--debounce') {
      options.debounceMs = Number(argv[++index]);
    } else if (!options.root) {
      options.root = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!options.root) {
    throw new Error('Usage: kestrel-scan <root> [--name <name>] [--watch] [--exclude <glob>]');
  }
  return options;
}

export function runScanCli(options: ScanCliOptions, emit: (event: ScanEvent) => void): { stop(): void } {
  const logger: Logger = {
    info: (message) => emit({ type: 'log', level: 'info', message }),
    warn: (message) => emit({ type: 'log', level: 'warn', message }),
    error: (message, error) =>
      emit({ type: 'log', level: 'error', message: error ? `${message}: ${describe(error)}` : message }),
  };
  const root = path.resolve(options.root);
  const scanner = new FsRepositoryScanner({ path: root, name: options.name }, { extraExcludes: options.excludes }, logger);
  const service = new ArchitectureService(scanner, logger);

  let running = false;
  let queued = false;
  const build = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    emit({ type: 'scanning' });
    try {
      emit({ type: 'graph', graph: await service.build() });
    } catch (error) {
      emit({ type: 'error', message: describe(error) });
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void build();
      }
    }
  };

  void build();
  if (!options.watch) {
    return { stop: () => service.dispose() };
  }

  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void build(), options.debounceMs);
  };

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const relative = filename ? filename.toString().split(path.sep).join('/') : '';
    if (relative && !isIgnoredFile(relative) && isArchitectureInput(relative)) {
      schedule();
    }
  });

  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => {
    if (line.trim() === 'scan') {
      void build();
    }
  });

  return {
    stop: () => {
      clearTimeout(timer);
      watcher.close();
      input.close();
      service.dispose();
    },
  };
}

/** Sources and the manifests the profiler reads; everything else cannot change the graph. */
function isArchitectureInput(relativePath: string): boolean {
  return (
    /\.(ts|tsx)$/.test(relativePath) ||
    /(^|\/)(package\.json|schema\.prisma|docker-compose[^/]*\.ya?ml|nest-cli\.json|angular\.json)$/.test(relativePath)
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
  try {
    const options = parseScanArgs(process.argv.slice(2));
    const write = (event: ScanEvent): void => {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    };
    const handle = runScanCli(options, write);
    if (options.watch) {
      process.on('SIGTERM', () => {
        handle.stop();
        process.exit(0);
      });
    }
  } catch (error) {
    process.stderr.write(`${describe(error)}\n`);
    process.exit(2);
  }
}
