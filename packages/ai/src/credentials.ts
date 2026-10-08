/**
 * Where the Anthropic credentials come from.
 *
 * The SDK resolves credentials on its own, in a documented order. KESTREL only
 * needs to know *whether* something is resolvable, so the chat can say "ready"
 * before a request is made.
 *
 * Anthropic ships no credential-storing CLI, so there is no third source to
 * discover on disk: it is a stored key, the environment, or nothing.
 */
export type CredentialSource = 'stored' | 'environment';

export const CREDENTIAL_LABELS: Readonly<Record<CredentialSource, string>> = {
  stored: 'stored API key',
  environment: 'ANTHROPIC_API_KEY environment variable',
};

export function hasEnvironmentCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * The credential the chat would use right now, in the SDK's own precedence
 * order: an explicit key first, then the environment.
 */
export function resolveCredentialSource(storedKey: string | undefined): CredentialSource | undefined {
  if (storedKey) {
    return 'stored';
  }
  if (hasEnvironmentCredentials()) {
    return 'environment';
  }
  return undefined;
}
