'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { authClient, ensureActiveOrganization } from '@/lib/auth-client';

import { Brand } from './Brand';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const next = params.get('import') === 'github' ? '/projects?new=github' : '/projects';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const result =
      mode === 'signup'
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    if (result.error) {
      setError(result.error.message ?? 'Something went wrong.');
      setBusy(false);
      return;
    }
    await ensureActiveOrganization(result.data?.user.name ?? (name.trim() || email));
    router.push(next);
  };

  return (
    <main className="auth">
      <form className="auth__card" onSubmit={submit}>
        <Brand />
        <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        {mode === 'signup' ? (
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        ) : null}
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </label>
        {error ? <div className="error-text">{error}</div> : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <div className="auth__switch">
          {mode === 'signup' ? (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          ) : (
            <>
              New to KESTREL? <Link href="/signup">Create an account</Link>
            </>
          )}
        </div>
      </form>
    </main>
  );
}
