import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, CircleAlert, LoaderCircle, Square } from 'lucide-react';

/** One control row: in flow beside the composer, docked while reading elsewhere. */
export function ConversationActivity({ label, active, attention, stopping, disabled, onStop, onLatest, children }: {
  label: string; active: boolean; attention: boolean; stopping: boolean; disabled: boolean;
  onStop: () => void; onLatest: () => void; children?: ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null), row = useRef<HTMLDivElement>(null), details = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState<CSSProperties>();
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      const slot = anchor.current!, control = row.current!, rect = slot.getBoundingClientRect();
      const height = control.getBoundingClientRect().height;
      slot.style.height = `${height}px`;
      document.documentElement.style.setProperty('--conversation-status-height', `${height + 12}px`);
      const viewport = window.visualViewport;
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : innerHeight;
      const keyboard = viewportBottom < innerHeight - 100;
      const bottom = viewportBottom - (keyboard ? 8 : (document.querySelector('.mobile-nav')?.getBoundingClientRect().height || 0) + 12);
      const top = Math.max(viewport?.offsetTop || 0, document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0, document.querySelector('.conversation-page-header')?.getBoundingClientRect().bottom || 0);
      const next = (!active && !attention) || (rect.top >= top && rect.top + height <= bottom) ? undefined : { left: rect.left, width: rect.width, bottom: innerHeight - bottom };
      setDock(old => old?.left === next?.left && old?.width === next?.width && old?.bottom === next?.bottom ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    for (const el of [anchor.current, row.current, document.querySelector('.mobile-nav'), document.querySelector('.conversation-page-header')]) if (el) observer.observe(el);
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
      document.documentElement.style.removeProperty('--conversation-status-height');
    };
  }, [active, attention]);
  function reveal() {
    if (!attention) { onLatest(); return; }
    details.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    const target = details.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') || details.current;
    target?.focus({ preventScroll: true });
  }
  return <section className="conversation-activity" aria-label="Conversation activity">
    {children && <div ref={details} className="conversation-attention" tabIndex={-1}>{children}</div>}
    <div ref={anchor} className="conversation-status-anchor"><div ref={row} className={`conversation-status ${dock ? 'is-docked' : ''} ${attention ? 'needs-attention' : ''}`} style={dock}>
      <button className="conversation-status-link" onClick={reveal} aria-label={attention ? `${label}: view details` : 'Show latest activity'}>
        {attention ? <CircleAlert size={17}/> : active ? <LoaderCircle size={17} className="spin"/> : <Square size={15}/>}
        <span role="status">{label}</span><ArrowDown size={15}/>
      </button>
      {active && <button className="conversation-stop" disabled={disabled || stopping} onClick={onStop}><Square size={13}/>{stopping ? 'Stopping…' : 'Stop'}</button>}
    </div></div>
  </section>;
}
