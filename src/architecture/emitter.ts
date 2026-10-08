export type Listener<T> = (value: T) => void;

export interface Disposable {
  dispose(): void;
}

/**
 * Tiny event emitter so the architecture engine can publish updates without
 * depending on `vscode.EventEmitter`.
 */
export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
