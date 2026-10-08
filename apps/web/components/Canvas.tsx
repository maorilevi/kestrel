'use client';

import '@xyflow/react/dist/style.css';
import '@kestrel/ui/styles.css';
import '@kestrel/ui/theme.css';

import { mountKestrel } from '@kestrel/ui';
import { useEffect, useRef } from 'react';

import type { ProjectChannel } from '@/lib/channel';

/** The KESTREL architecture canvas, talking to the project channel. */
export default function Canvas({ channel }: { channel: ProjectChannel }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) {
      return;
    }
    // The canvas is its own React root, in an element of its own per mount, so
    // a remount never reuses a container whose old root is still unmounting.
    const element = document.createElement('div');
    element.style.height = '100%';
    container.current.appendChild(element);
    const root = mountKestrel(element, channel.transport());
    // Unmounting inside this commit would race the parent render: defer it.
    return () => {
      setTimeout(() => {
        root.unmount();
        element.remove();
      });
    };
  }, [channel]);

  return (
    <div className="kestrel-host">
      <div ref={container} />
    </div>
  );
}
