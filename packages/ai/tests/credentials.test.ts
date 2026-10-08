import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCredentialSource } from '../src/credentials';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('credential resolution', () => {
  it('prefers a stored key over everything else', () => {
    process.env.ANTHROPIC_API_KEY = 'from-env';
    expect(resolveCredentialSource('stored-key')).toBe('stored');
  });

  it('falls back to the environment when nothing is stored', () => {
    process.env.ANTHROPIC_API_KEY = 'from-env';
    expect(resolveCredentialSource(undefined)).toBe('environment');
  });

  it('accepts an auth token as an environment credential', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = 'token';
    expect(resolveCredentialSource(undefined)).toBe('environment');
  });

  it('reports nothing when the machine has no credentials at all', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    expect(resolveCredentialSource(undefined)).toBeUndefined();
  });

  it('never invents a credential the SDK cannot actually read', () => {
    // Anthropic ships no credential-storing CLI, so nothing on disk counts as
    // a sign-in. Claiming otherwise made the chat report "ready" and then fail.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.APPDATA = 'C:/Users/someone/AppData/Roaming';
    process.env.XDG_CONFIG_HOME = '/home/someone/.config';
    expect(resolveCredentialSource(undefined)).toBeUndefined();
  });
});
