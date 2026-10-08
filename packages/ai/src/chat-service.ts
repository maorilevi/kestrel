import type { ArchitectureGraph, Logger } from '@kestrel/core';
import { buildChatContext } from './chat-context';
import {
  ChatNotConfiguredError,
  type ChatProvider,
  type ChatTurn,
  type ChatUsage,
} from './chat-provider';

export interface ChatAsk {
  question: string;
  selectedNodeIds: readonly string[];
  projectId: string | null;
}

export interface ChatHandlers {
  onDelta(text: string): void;
  onDone(usage: ChatUsage & { provider: string }): void;
  onError(message: string, remedyCommand?: string): void;
}

/**
 * Where the chat reads the current architecture from: the engine itself in the
 * extension, the latest graph a sandbox streamed in the web control plane.
 */
export interface GraphSource {
  getGraph(): ArchitectureGraph;
}

export interface ChatStatus {
  ready: boolean;
  provider?: string;
  message?: string;
  remedyCommand?: string;
}

/**
 * Owns the conversation and picks a provider.
 *
 * The architecture is re-read from the service on every turn, so an answer
 * always describes the code as it is now, not as it was when the panel opened.
 */
export class ChatService {
  private turns: ChatTurn[] = [];
  private inFlight: AbortController | undefined;

  constructor(
    private readonly architecture: GraphSource,
    private readonly providers: readonly ChatProvider[],
    private readonly logger: Logger,
    /** Reads the configured preference on every request. */
    private readonly getPreference: () => 'auto' | 'anthropic' | 'vscode' = () => 'auto',
  ) {}

  /** Which provider would answer right now, and whether it can. */
  async status(): Promise<ChatStatus> {
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        return { ready: true, provider: provider.label };
      }
    }
    const preference = this.getPreference();
    if (preference !== 'auto') {
      return {
        ready: false,
        message:
          `The ${preference === 'anthropic' ? 'Anthropic' : 'VS Code'} provider is selected but cannot ` +
          'answer right now. Change the provider in KESTREL settings, or connect it.',
        remedyCommand: 'kestrel.openSettings',
      };
    }

    return {
      ready: false,
      message:
        'Not connected to a model yet. Store an Anthropic API key, ' +
        'or install a language model in VS Code.',
      remedyCommand: 'kestrel.signIn',
    };
  }

  get history(): readonly ChatTurn[] {
    return this.turns;
  }

  clear(): void {
    this.cancel();
    this.turns = [];
  }

  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = undefined;
  }

  async ask(ask: ChatAsk, handlers: ChatHandlers): Promise<void> {
    const question = ask.question.trim();
    if (question.length === 0) {
      return;
    }

    const graph = this.architecture.getGraph();
    if (graph.nodes.length === 0) {
      handlers.onError('Build the architecture first — there is nothing to ask about yet.');
      return;
    }

    const provider = await this.selectProvider();
    if (!provider) {
      const status = await this.status();
      handlers.onError(status.message ?? 'No language model is available.', status.remedyCommand);
      return;
    }

    const context = buildChatContext(graph, {
      selectedNodeIds: ask.selectedNodeIds,
      projectId: ask.projectId,
    });

    this.logger.info(
      `Chat: asking ${provider.label} — ${context.brief.length} characters of architecture, ` +
        `${ask.selectedNodeIds.length} node(s) in focus, turn ${this.turns.length + 1}.`,
    );

    this.turns.push({ role: 'user', content: question });

    this.cancel();
    const controller = new AbortController();
    this.inFlight = controller;

    let answer = '';

    try {
      const usage = await provider.send(
        {
          brief: context.brief,
          focus: context.focus,
          turns: this.turns,
          signal: controller.signal,
        },
        (delta) => {
          answer += delta;
          handlers.onDelta(delta);
        },
      );

      // Silence is not an answer: recording it would poison the next turn and
      // leave the panel looking broken.
      if (answer.trim().length === 0) {
        throw new Error(
          `${provider.label} returned an empty answer. Try again, or connect a different model.`,
        );
      }

      this.turns.push({ role: 'assistant', content: answer });
      handlers.onDone({ ...usage, provider: provider.label });

      this.logger.info(
        `Chat answered with ${provider.label}` +
          (usage.inputTokens !== undefined
            ? ` (${usage.inputTokens} in / ${usage.outputTokens ?? 0} out` +
              (usage.cachedTokens ? `, ${usage.cachedTokens} cached` : '') +
              ')'
            : ''),
      );
    } catch (error) {
      // A cancelled turn is not a failure, but its question must not linger.
      if (controller.signal.aborted) {
        this.turns.pop();
        handlers.onDone({ provider: provider.label });
        return;
      }

      this.turns.pop();
      const message = error instanceof Error ? error.message : String(error);
      const remedy = error instanceof ChatNotConfiguredError ? error.remedyCommand : undefined;
      this.logger.error('Chat request failed.', error);
      handlers.onError(message, remedy);
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = undefined;
      }
    }
  }

  /**
   * Honours the configured preference: `auto` takes the first provider that can
   * answer, a named preference uses only that one — so choosing a provider and
   * silently getting a different one is impossible.
   */
  private async selectProvider(): Promise<ChatProvider | undefined> {
    const preference = this.getPreference();
    const candidates =
      preference === 'auto'
        ? this.providers
        : this.providers.filter((provider) => provider.id === preferredId(preference));

    for (const provider of candidates) {
      if (await provider.isAvailable()) {
        return provider;
      }
    }
    return undefined;
  }
}

/** Maps the setting value onto a provider id. */
function preferredId(preference: 'anthropic' | 'vscode'): string {
  return preference === 'anthropic' ? 'anthropic' : 'vscode-lm';
}
