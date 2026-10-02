import { requestConversationPosition } from './conversationViewport';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function HistoryDisclosure({ label, children, onInteract, activityKey }: { label: ReactNode; children: ReactNode; onInteract: () => void; activityKey?: string }) {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLButtonElement>(null), previousTop = useRef<number | null>(null);
  const contentId = useId();
  useLayoutEffect(() => {
    if (previousTop.current === null || !header.current) return;
    // Counter browser scroll anchoring before paint, keeping the collapse control in reach.
    requestConversationPosition(header.current, 'restore');
    previousTop.current = null;
  }, [open]);
  return <div className={activityKey ? 'activity-group' : 'history-disclosure'}>
    <button ref={header} type="button" className="history-disclosure-toggle" aria-expanded={open} aria-controls={contentId} data-history-message={activityKey} onClick={() => {
      previousTop.current = header.current!.getBoundingClientRect().top;
      requestConversationPosition(header.current, 'hold');
      onInteract(); setOpen(value => !value);
    }}><ChevronRight size={15} aria-hidden="true"/>{label}</button>
    <div id={contentId} hidden={!open}>{open && children}</div>
  </div>;
}
