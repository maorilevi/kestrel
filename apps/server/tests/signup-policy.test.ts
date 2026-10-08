import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import { isSignupAllowed, parseSignupPolicy } from '../src/signup-policy';

describe('sign-up policy', () => {
  it('allows listed addresses and domains, case-insensitively', () => {
    const policy = parseSignupPolicy(' Maya@Example.com, @team.dev ,', false);
    expect(isSignupAllowed(policy, 'maya@example.com')).toBe(true);
    expect(isSignupAllowed(policy, 'Someone@TEAM.dev')).toBe(true);
    expect(isSignupAllowed(policy, 'other@example.com')).toBe(false);
    expect(isSignupAllowed(policy, 'x@sub.team.dev')).toBe(false);
    expect(isSignupAllowed(policy, 'not-an-email')).toBe(false);
  });

  it('is open in development and invite-only in production', () => {
    expect(loadConfig({}).signup.open).toBe(true);
    expect(loadConfig({ KESTREL_ALLOWED_EMAILS: '@team.dev' }).signup.open).toBe(false);

    const production = {
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 's'.repeat(64),
      SANDBOX_PROVIDER: 'e2b',
      E2B_API_KEY: 'e2b_test',
    };
    expect(() => loadConfig(production)).toThrow(/KESTREL_ALLOWED_EMAILS/);
    expect(loadConfig({ ...production, KESTREL_ALLOWED_EMAILS: 'maya@team.dev' }).signup.open).toBe(false);
    expect(loadConfig({ ...production, KESTREL_OPEN_SIGNUP: 'true' }).signup.open).toBe(true);
  });
});
