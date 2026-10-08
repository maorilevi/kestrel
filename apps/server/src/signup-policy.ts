/**
 * Who may create an account. During the private beta sign-up is limited to an
 * allowlist of addresses and whole domains (`@company.com`).
 */
export interface SignupPolicy {
  open: boolean;
  emails: ReadonlySet<string>;
  domains: ReadonlySet<string>;
}

export function parseSignupPolicy(allowlist: string | undefined, open: boolean): SignupPolicy {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const raw of (allowlist ?? '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (!entry) {
      continue;
    }
    if (entry.startsWith('@')) {
      domains.add(entry.slice(1));
    } else {
      emails.add(entry);
    }
  }
  return { open, emails, domains };
}

export function isSignupAllowed(policy: SignupPolicy, email: string): boolean {
  if (policy.open) {
    return true;
  }
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split('@')[1] ?? '';
  return policy.emails.has(normalized) || (domain !== '' && policy.domains.has(domain));
}
