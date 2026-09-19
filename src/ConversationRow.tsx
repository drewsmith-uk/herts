import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, MessageSquare, Plus } from 'lucide-react';
import type { Conversation } from '../shared/core';

export function ConversationRow({ conversation: c, updatedAt, online, busy, onAction, actionLabel, badges, canActOffline }: {
  conversation: Conversation; updatedAt: string; online: boolean; busy: boolean; actionLabel?:string;badges?:ReactNode;canActOffline?:boolean;
  onAction: (kind: 'plugin' | 'visibility') => Promise<void>;
}) {
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; horizontal: boolean; threshold: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const canAct = !busy && !!actionLabel && (online || canActOffline);
  function down(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0 || busy) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, horizontal: false, threshold: Math.min(90, e.currentTarget.clientWidth * .25) };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.horizontal) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { gesture.current = null; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      g.horizontal = true; e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (e.cancelable) e.preventDefault();
    g.dx = dx; setOffset(Math.max(-130, Math.min(canAct ? 130 : 24, dx)));
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    gesture.current = null; setOffset(0);
    if (g.horizontal) suppressClickUntil.current = Date.now() + 600;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancelled && g.horizontal && Math.abs(g.dx) >= g.threshold) {
      if (g.dx < 0) void onAction('visibility');
      else if (canAct) void onAction('plugin');
    }
  }
  const label = actionLabel || 'Actions';
  const visibilityLabel = c.hidden ? 'Unhide' : 'Hide';
  return <div className={`conversation-item ${c.hidden ? 'is-hidden-item' : ''}`} data-conversation-key={c.key} aria-busy={busy}
    onPointerDown={down} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)}
    onLostPointerCapture={e => { if (e.target === e.currentTarget) finish(e, true); /* Ignore implicit touch capture transferred from the link to this row. */ }}
    onClickCapture={e => { if (e.detail !== 0 && Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); } }}>
    <div className={`conversation-swipe-action ${offset > 0 ? 'to-task' : 'to-hide'}`} aria-hidden="true">
      {offset > 0 ? <><Plus size={20}/>{label}</> : <>{c.hidden ? <Eye size={20}/> : <EyeOff size={20}/>}{visibilityLabel}</>}
    </div>
    <div className={`conversation-item-content ${offset ? 'swiping' : ''}`} style={{ transform: `translateX(${offset}px)` }}>
      <a className="conversation-row" draggable={false} onDragStart={e => e.preventDefault()} href={`#/conversation/${encodeURIComponent(c.key)}`}>
        <div className="conversation-avatar"><MessageSquare size={20}/></div><div className="conversation-row-body"><h2>{c.title}</h2><p>{c.preview || 'Open to read available history.'}</p><div className="task-meta"><span>{c.source}</span><span>{updatedAt}</span>{badges}{c.hidden && <span className="hidden-item-badge"><EyeOff size={12}/>Hidden</span>}</div></div>{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowRight size={17}/>}
      </a>
    </div>
  </div>;
}
