/**
 * Minimal logging port so the architecture engine stays free of VS Code.
 * The extension supplies an implementation backed by the KESTREL OutputChannel.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export const noopLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
