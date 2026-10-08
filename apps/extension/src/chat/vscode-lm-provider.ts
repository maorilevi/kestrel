import * as vscode from 'vscode';

import type { Logger } from '@kestrel/core';
import { noopLogger } from '@kestrel/core';
import { CHAT_SYSTEM_PROMPT } from '@kestrel/ai';
import {
  ChatNotConfiguredError,
  type ChatProvider,
  type ChatRequest,
  type ChatUsage,
} from '@kestrel/ai';

/** Leave room for the answer and for the model's own framing. */
const INPUT_BUDGET_RATIO = 0.7;

/**
 * Fallback provider using the language models VS Code already has, through the
 * documented `vscode.lm` API.
 *
 * These models have far smaller input budgets than the Anthropic API, and some
 * return an empty response instead of an error when a request is too large — so
 * the architecture brief is measured with the model's own tokenizer and trimmed
 * to fit before anything is sent.
 */
export class VsCodeLanguageModelProvider implements ChatProvider {
  readonly id = 'vscode-lm';
  private cached: vscode.LanguageModelChat | undefined;

  constructor(
    private readonly logger: Logger = noopLogger,
    /** Id of the model the user pinned in settings; empty means automatic. */
    private readonly getPreferredId: () => string = () => '',
  ) {}

  get label(): string {
    return this.cached ? `${this.cached.name} (VS Code)` : 'VS Code language model';
  }

  async isAvailable(): Promise<boolean> {
    return (await this.selectModel()) !== undefined;
  }

  async send(request: ChatRequest, onDelta: (text: string) => void): Promise<ChatUsage> {
    const model = await this.selectModel();
    if (!model) {
      throw new ChatNotConfiguredError(
        'No language model is available in VS Code. Store an Anthropic API key instead.',
      );
    }

    const source = new vscode.CancellationTokenSource();
    const abort = (): void => source.cancel();
    request.signal.addEventListener('abort', abort);

    try {
      const brief = await this.fitBrief(model, request, source.token);
      const messages = buildMessages(brief, request);

      const inputTokens = await this.countMessages(model, messages, source.token);
      this.logger.info(
        `Chat: ${model.vendor}/${model.family} "${model.name}" — ` +
          `${inputTokens} input tokens of ${model.maxInputTokens} allowed.`,
      );

      const response = await model.sendRequest(messages, {}, source.token);

      let received = 0;
      for await (const fragment of response.text) {
        received += fragment.length;
        onDelta(fragment);
      }

      // Some providers answer an over-long or filtered request with an empty
      // stream and no error. Silence is not an answer.
      if (received === 0) {
        throw new Error(
          `${model.name} returned an empty answer. It may have refused the request or run out of ` +
            'input budget. Signing in to Anthropic gives KESTREL a model with room for the whole architecture.',
        );
      }

      return { inputTokens };
    } catch (error) {
      if (error instanceof vscode.LanguageModelError) {
        throw new Error(`${model.name}: ${error.message}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      request.signal.removeEventListener('abort', abort);
      source.dispose();
    }
  }

  /** Drops whole sections off the end of the brief until it fits the model. */
  private async fitBrief(
    model: vscode.LanguageModelChat,
    request: ChatRequest,
    token: vscode.CancellationToken,
  ): Promise<string> {
    const budget = Math.floor(model.maxInputTokens * INPUT_BUDGET_RATIO);
    const overhead = await this.count(model, CHAT_SYSTEM_PROMPT + request.focus, token);
    const questions = await this.count(model, request.turns.map((t) => t.content).join('\n'), token);
    const allowance = budget - overhead - questions;

    let brief = request.brief;
    if ((await this.count(model, brief, token)) <= allowance) {
      return brief;
    }

    const sections = brief.split(/\n(?=## )/);
    while (sections.length > 1 && (await this.count(model, sections.join('\n'), token)) > allowance) {
      sections.pop();
    }

    brief = sections.join('\n');
    this.logger.warn(
      `Chat: the architecture was trimmed to ${sections.length} section(s) to fit ` +
        `${model.name}'s ${model.maxInputTokens} token limit.`,
    );
    return `${brief}\n\n(Trimmed to fit this model's context. Some detail is missing.)`;
  }

  private async count(
    model: vscode.LanguageModelChat,
    text: string,
    token: vscode.CancellationToken,
  ): Promise<number> {
    try {
      return await model.countTokens(text, token);
    } catch {
      // Without a tokenizer, four characters per token is close enough to keep
      // the request inside the budget.
      return Math.ceil(text.length / 4);
    }
  }

  private async countMessages(
    model: vscode.LanguageModelChat,
    messages: readonly vscode.LanguageModelChatMessage[],
    token: vscode.CancellationToken,
  ): Promise<number> {
    let total = 0;
    for (const message of messages) {
      total += await this.count(model, textOf(message), token);
    }
    return total;
  }

  /**
   * Picks a model that can actually serve a request.
   *
   * Some registrations are placeholders — a CLI integration may advertise a
   * model with a zero token budget that answers nothing. Being listed is not
   * the same as being usable, so those are filtered out and the provider
   * reports itself unavailable rather than answering with silence.
   */
  private async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    const pinned = this.getPreferredId();
    // A model chosen in settings must win, and a changed choice must take
    // effect without a reload — so the cache is only for the automatic case.
    if (this.cached && this.cached.id === (pinned || this.cached.id)) {
      return this.cached;
    }
    this.cached = undefined;

    let models: readonly vscode.LanguageModelChat[];
    try {
      models = await vscode.lm.selectChatModels();
    } catch {
      return undefined;
    }

    if (models.length > 0) {
      this.logger.info(
        `Chat: VS Code offers ${models
          .map((model) => `${model.vendor}/${model.family || '?'} "${model.name}" (${model.maxInputTokens} tokens)`)
          .join(', ')}.`,
      );
    }

    const usable = models.filter(
      (model) => typeof model.maxInputTokens !== 'number' || model.maxInputTokens > 0,
    );

    if (pinned) {
      const chosen = usable.find((model) => model.id === pinned);
      if (chosen) {
        this.cached = chosen;
        return chosen;
      }
      this.logger.warn(`Chat: the pinned model "${pinned}" is not available; falling back.`);
    }

    if (usable.length === 0) {
      if (models.length > 0) {
        this.logger.warn(
          'Chat: every language model VS Code offers reports a zero token budget, so none can answer.',
        );
      }
      return undefined;
    }

    // Prefer Claude, then whichever model has room for the most architecture.
    const claude = usable.filter(
      (model) => /claude/i.test(model.family) || /claude/i.test(model.name),
    );
    const pool = claude.length > 0 ? claude : usable;

    this.cached = pool.reduce(
      (best, model) => ((model.maxInputTokens ?? 0) > (best.maxInputTokens ?? 0) ? model : best),
      pool[0],
    );
    return this.cached;
  }
}

/**
 * The `vscode.lm` API has no system role, so the instructions and the
 * architecture lead the conversation as the first exchange.
 */
function buildMessages(brief: string, request: ChatRequest): vscode.LanguageModelChatMessage[] {
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(`${CHAT_SYSTEM_PROMPT}\n\n${brief}`),
    vscode.LanguageModelChatMessage.Assistant(
      'Understood. I have the architecture and will answer questions about it.',
    ),
  ];

  for (const [index, turn] of request.turns.entries()) {
    const isLast = index === request.turns.length - 1;
    const content =
      isLast && turn.role === 'user' && request.focus.length > 0
        ? `${request.focus}\n\n---\n\n${turn.content}`
        : turn.content;

    messages.push(
      turn.role === 'user'
        ? vscode.LanguageModelChatMessage.User(content)
        : vscode.LanguageModelChatMessage.Assistant(content),
    );
  }

  return messages;
}

/**
 * Message content is a plain string in the API version this extension compiles
 * against, and an array of parts in newer VS Code releases. Read both, without
 * depending on a type that older `@types/vscode` does not declare.
 */
function textOf(message: vscode.LanguageModelChatMessage): string {
  const content: unknown = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'value' in part
          ? String((part as { value: unknown }).value)
          : '',
      )
      .join('');
  }

  return '';
}
