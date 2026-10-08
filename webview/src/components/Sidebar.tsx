import { useCallback, useRef, type ReactNode } from 'react';

export interface SidebarProps {
  /** Inspector — the top half. */
  top: ReactNode;
  /** Chat — the bottom half, always present. */
  bottom: ReactNode;
  /** Share of the height given to the chat, between 0.15 and 0.85. */
  split: number;
  collapsed: boolean;
  onSplitChange: (split: number) => void;
}

const MIN_SPLIT = 0.15;
const MAX_SPLIT = 0.85;

/**
 * The right-hand column: what is selected, and the conversation about it.
 *
 * Both halves are permanent parts of the screen. The chat can be collapsed to
 * its header to give the graph more room, but it is never removed — collapsing
 * keeps the conversation mounted so a streaming answer is not interrupted.
 */
export function Sidebar({ top, bottom, split, collapsed, onSplitChange }: SidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent): void => {
        const bounds = container.getBoundingClientRect();
        if (bounds.height === 0) {
          return;
        }
        const fromTop = (moveEvent.clientY - bounds.top) / bounds.height;
        onSplitChange(clamp(1 - fromTop, MIN_SPLIT, MAX_SPLIT));
      };

      const stop = (): void => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
    },
    [onSplitChange],
  );

  const chatShare = collapsed ? 0 : clamp(split, MIN_SPLIT, MAX_SPLIT);

  return (
    <div className="kestrel-sidebar" ref={containerRef}>
      <div className="kestrel-sidebar__top" style={{ flex: `1 1 ${(1 - chatShare) * 100}%` }}>
        {top}
      </div>

      {collapsed ? null : (
        <div
          className="kestrel-sidebar__handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the chat"
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              onSplitChange(clamp(chatShare + 0.05, MIN_SPLIT, MAX_SPLIT));
            } else if (event.key === 'ArrowDown') {
              onSplitChange(clamp(chatShare - 0.05, MIN_SPLIT, MAX_SPLIT));
            }
          }}
        />
      )}

      <div
        className={`kestrel-sidebar__bottom${collapsed ? ' is-collapsed' : ''}`}
        style={collapsed ? undefined : { flex: `1 1 ${chatShare * 100}%` }}
      >
        {bottom}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
