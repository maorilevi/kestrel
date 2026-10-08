import { ProjectRuntime, type RuntimeDependencies } from './runtime';
import type { ProjectRecord } from './store';

/** Keeps at most one runtime per project in this process. */
export class RuntimeManager {
  private readonly runtimes = new Map<string, ProjectRuntime>();

  constructor(private readonly deps: RuntimeDependencies) {}

  get(record: ProjectRecord): ProjectRuntime {
    let runtime = this.runtimes.get(record.id);
    if (!runtime) {
      runtime = new ProjectRuntime(record, this.deps);
      this.runtimes.set(record.id, runtime);
    }
    return runtime;
  }

  peek(projectId: string): ProjectRuntime | undefined {
    return this.runtimes.get(projectId);
  }

  async destroy(record: ProjectRecord): Promise<void> {
    const runtime = this.get(record);
    this.runtimes.delete(record.id);
    await runtime.destroy();
  }

  /** Stops every running project, keeping their sandboxes for the next start. */
  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.stop()));
    this.runtimes.clear();
  }
}
