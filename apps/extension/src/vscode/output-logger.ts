import * as vscode from 'vscode';

import type { Logger } from '@kestrel/core';

/** KESTREL OutputChannel backed logger. */
export class OutputChannelLogger implements Logger {
  constructor(private readonly channel: vscode.OutputChannel) {}

  info(message: string): void {
    this.channel.appendLine(`[${timestamp()}] ${message}`);
  }

  warn(message: string): void {
    this.channel.appendLine(`[${timestamp()}] warn: ${message}`);
  }

  error(message: string, error?: unknown): void {
    this.channel.appendLine(`[${timestamp()}] error: ${message}`);
    if (error instanceof Error && error.stack) {
      this.channel.appendLine(error.stack);
    } else if (error !== undefined) {
      this.channel.appendLine(String(error));
    }
  }

  show(): void {
    this.channel.show(true);
  }
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}
