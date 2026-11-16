'use client';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

type Props = {
  id: string;
  label: string;
  open: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
};

export function ToolbarPopover({ id, label, open, anchor, onClose, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const button = anchor.current;
    if (!element || !button || !open) return;
    function position() {
      const rect = button!.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 32);
      const left = Math.max(
        16,
        Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16),
      );
      const below = window.innerHeight - rect.bottom - 24;
      const above = rect.top - 24;
      const flipped = below < 180 && above > below;
      element!.style.width = width + 'px';
      element!.style.left = left + 'px';
      element!.style.setProperty(
        '--popover-arrow',
        Math.max(16, Math.min(width - 16, rect.left + rect.width / 2 - left)) + 'px',
      );
      element!.style.setProperty(
        '--popover-height',
        Math.max(80, Math.min(300, flipped ? above : below)) + 'px',
      );
      element!.dataset.above = String(flipped);
      element!.style.top = flipped ? 'auto' : rect.bottom + 10 + 'px';
      element!.style.bottom = flipped ? window.innerHeight - rect.top + 10 + 'px' : 'auto';
    }
    position();
    element.showPopover();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      element.hidePopover();
    };
  }, [open, anchor]);
  return (
    <div
      ref={panel}
      id={id}
      popover="auto"
      className="composer-popover"
      role="dialog"
      aria-label={label}
      onToggle={(event) => {
        if (event.newState === 'closed') onClose();
      }}
    >
      <div className="composer-popover-body">{children}</div>
    </div>
  );
}
