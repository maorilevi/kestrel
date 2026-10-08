import Anthropic from '@anthropic-ai/sdk';

import { CHAT_SYSTEM_PROMPT } from './chat-context';
import { CREDENTIAL_LABELS, resolveCredentialSource, type CredentialSource } from './credentials';
import {
  ChatNotConfiguredError,
  type ChatProvider,
  type ChatRequest,
  type ChatUsage,
} from './chat-provider';

export interface AnthropicProviderOptions {
  /** Reads the key from VS Code SecretStorage; never from settings. */
  getApiKey(): Promise<string | undefined>;
  /**
   * Read lazily on every request: a model chosen in the settings panel has to
   * apply to the next question, not the next window reload.
   */
  getModel?: () => string;
  getEffort?: () => 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  getTimeoutMs?: () => number;
  maxTokens?: number;
}

/** Commands the panel offers when nothing is configured. */
export const SET_API_KEY_COMMAND = 'kestrel.setApiKey';
export const SIGN_IN_COMMAND = 'kestrel.signIn';

const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Anthropic Messages API provider.
 *
 * The architecture brief is sent as a cached system block: it is identical on
 * every turn of a conversation, so after the first request it is billed at a
 * fraction of the price. That is also why {@link buildChatContext} keeps
 * timestamps out of the brief — one changing byte would invalidate the cache.
 */
export class AnthropicChatProvider implements ChatProvider {
  readonly id = 'anthropic';

  constructor(private readonly options: AnthropicProviderOptions) {}

  /** Which credential the last availability check resolved. */
  private source: CredentialSource | undefined;

  get label(): string {
    const model = modelLabel(this.model);
    return this.source && this.source !== 'stored'
      ? model + ' · ' + CREDENTIAL_LABELS[this.source]
      : model;
  }

  get model(): string {
    return this.options.getModel?.() ?? DEFAULT_MODEL;
  }

  async isAvailable(): Promise<boolean> {
    this.source = resolveCredentialSource(await this.options.getApiKey());
    return this.source !== undefined;
  }

  async send(request: ChatRequest, onDelta: (text: string) => void): Promise<ChatUsage> {
    const apiKey = await this.options.getApiKey();
    this.source = resolveCredentialSource(apiKey);

    if (!this.source) {
      throw new ChatNotConfiguredError(
        'No Anthropic credentials. Store an API key, or switch to a model VS Code provides, to chat about your architecture.',
        SIGN_IN_COMMAND,
      );
    }

    let client: Anthropic;
    try {
      client = new Anthropic({
        // Only pass a key when we hold one: with none, the SDK resolves the
        // environment or a signed-in profile itself, which is what lets this
        // work without anyone pasting a secret.
        ...(apiKey ? { apiKey } : {}),
        // The SDK waits 10 minutes by default; a chat panel that appears frozen
        // for that long is indistinguishable from a broken one.
        timeout: this.options.getTimeoutMs?.() ?? 120_000,
        maxRetries: 1,
      });
    } catch (error) {
      throw new ChatNotConfiguredError(
        'Anthropic credentials could not be loaded: ' +
          (error instanceof Error ? error.message : String(error)),
        SIGN_IN_COMMAND,
      );
    }
    const messages: Anthropic.MessageParam[] = request.turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

    // The focus block is volatile, so it goes after the cache breakpoint.
    if (request.focus.length > 0 && messages.length > 0) {
      const last = messages[messages.length - 1];
      last.content = `${request.focus}\n\n---\n\n${String(last.content)}`;
    }

    try {
      const stream = client.messages.stream(
        {
          model: this.model,
          max_tokens: this.options.maxTokens ?? 64_000,
          thinking: { type: 'adaptive' },
          output_config: { effort: this.options.getEffort?.() ?? 'high' },
          system: [
            { type: 'text', text: CHAT_SYSTEM_PROMPT },
            {
              type: 'text',
              text: request.brief,
              // Everything up to here is identical between turns.
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages,
        },
        { signal: request.signal },
      );

      stream.on('text', onDelta);

      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        throw new Error(
          `The model declined to answer${
            message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'
          }`,
        );
      }

      return {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cachedTokens: message.usage.cache_read_input_tokens ?? undefined,
      };
    } catch (error) {
      throw describeError(error);
    }
  }
}

/** Turns SDK errors into something worth showing a developer. */
function describeError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new ChatNotConfiguredError(
      'Anthropic rejected the credentials. Store a valid API key, or switch to a model VS Code provides.',
      SET_API_KEY_COMMAND,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new Error('Rate limited by the Anthropic API. Wait a moment and ask again.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new Error(`The request was rejected: ${error.message}`);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new Error(
      'The request timed out. If you are behind a corporate proxy, set the http.proxy setting in VS Code.',
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new Error(
      `Could not reach the Anthropic API: ${error.message}. Check your network or proxy settings.`,
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new Error(`Anthropic API error ${error.status ?? ''}: ${error.message}`.trim());
  }
  // Raised by the SDK before any request when it cannot resolve a credential.
  // `APIError` extends this, so the check has to come last.
  if (error instanceof Anthropic.AnthropicError) {
    return new ChatNotConfiguredError(
      'Anthropic credentials could not be resolved. Store an API key, ' +
        'or switch to a model VS Code provides.',
      SIGN_IN_COMMAND,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function modelLabel(model: string): string {
  const known: Record<string, string> = {
    'claude-opus-5': 'Claude Opus 5',
    'claude-sonnet-5': 'Claude Sonnet 5',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'claude-opus-4-8': 'Claude Opus 4.8',
  };
  return known[model] ?? model;
}
