/**
 * Port for the language model behind the chat panel.
 *
 * KESTREL's architecture engine has no idea a model exists; the chat feature
 * consumes the graph, not the other way around. Two implementations ship:
 * Anthropic's API, and the models VS Code already has.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** Stable architecture description — identical between turns so it caches. */
  brief: string;
  /** Volatile per-turn context, e.g. the current selection. */
  focus: string;
  /** Conversation so far, oldest first, ending with the new user turn. */
  turns: readonly ChatTurn[];
  signal: AbortSignal;
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

export interface ChatProvider {
  /** Stable id, e.g. `anthropic`. */
  readonly id: string;
  /** Shown in the panel, e.g. `Claude Opus 5`. */
  readonly label: string;

  /** True when the provider can serve a request right now. */
  isAvailable(): Promise<boolean>;

  /**
   * Streams a reply. Implementations must call `onDelta` as text arrives and
   * resolve when the reply is complete.
   */
  send(request: ChatRequest, onDelta: (text: string) => void): Promise<ChatUsage>;
}

/** Thrown when a provider is reachable but not configured to run. */
export class ChatNotConfiguredError extends Error {
  constructor(
    message: string,
    /** Command id that would fix it, if there is one. */
    readonly remedyCommand?: string,
  ) {
    super(message);
    this.name = 'ChatNotConfiguredError';
  }
}
