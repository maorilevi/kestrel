'use client';

import { useParams } from 'next/navigation';

import { useRequiredSession } from '@/components/useSession';
import { Workspace } from '@/components/Workspace';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const session = useRequiredSession();
  if (!session.data || !id) {
    return null;
  }
  return <Workspace projectId={id} />;
}
