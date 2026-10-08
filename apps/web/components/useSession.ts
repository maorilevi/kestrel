'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { authClient } from '@/lib/auth-client';

/** The signed-in user; sends anyone else to the sign-in page. */
export function useRequiredSession() {
  const router = useRouter();
  const session = authClient.useSession();

  useEffect(() => {
    if (!session.isPending && !session.data) {
      router.replace('/login');
    }
  }, [session.isPending, session.data, router]);

  return session;
}
