import { createPortal } from 'react-dom';
import { requestConversationPosition } from './conversationViewport';
import { useRef, type ReactNode } from 'react';
import { ArrowDown, CircleAlert, LoaderCircle, Square } from 'lucide-react';

/** One control row beside the composer; details stay in the history viewport. */
export function ConversationActivity({ label, active, attention, stopping, disabled, onStop, onLatest, children, statusHost }: {
  label: string; active: boolean; attention: boolean; stopping: boolean; disabled: boolean;
  onStop: () => void; onLatest: () => void; children?: ReactNode; statusHost?: HTMLElement | null;
}) {
  const details = useRef<HTMLDivElement>(null);
  function reveal() {
    if (!attention) { onLatest(); return; }
    requestConversationPosition(details.current, 'reveal');
    const target = details.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') || details.current;
    target?.focus({ preventScroll: true });
  }
  const row = <div className={`conversation-status ${attention ? 'needs-attention' : ''}`}>
      <button className="conversation-status-link" onClick={reveal} aria-label={attention ? `${label}: view details` : 'Show latest activity'}>
        {attention ? <CircleAlert size={17}/> : active ? <LoaderCircle size={17} className="spin"/> : <Square size={15}/>}
        <span role="status">{label}</span><ArrowDown size={15}/>
      </button>
      {active && <button className="conversation-stop" disabled={disabled || stopping} onClick={onStop}><Square size={13}/>{stopping ? 'Stopping…' : 'Stop'}</button>}
    </div>;
  return <section className="conversation-activity" aria-label="Conversation activity">{children && <div ref={details} className="conversation-attention" tabIndex={-1}>{children}</div>}{statusHost ? createPortal(row, statusHost) : row}</section>;
}
