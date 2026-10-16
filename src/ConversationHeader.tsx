import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronUp } from 'lucide-react';
import type { Conversation } from '../shared/core';
import type { ConversationContext } from '../shared/conversations';
import { ActionMenu } from './ui';
import { ConversationContributions } from './plugins';

export function ConversationHeader({ children, title, savedTitle, backHref, backLabel, context, conversation, actions, contributionsInDetails = false, visibilityActions }: {
  children: ReactNode; title?: string; savedTitle?: string; backHref?: string; backLabel?: string;
  context?: ConversationContext; conversation?: Conversation; actions?:ReactNode; contributionsInDetails?:boolean; visibilityActions?:ReactNode;
}) {
  const [hidden, setHidden] = useState(false), detailsId = useId();
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const fields = [...element.querySelectorAll<HTMLTextAreaElement>('textarea.detail-title')];
    const fit = (field: HTMLTextAreaElement) => {
      if (!field.getClientRects().length) return;
      const style = getComputedStyle(field), border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      field.style.height = '0px';
      field.style.height = `${Math.ceil(field.scrollHeight + border)}px`;
    };
    const fitAll = () => fields.forEach(fit);
    const widths = new WeakMap<Element, number>();
    let frame = 0;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) if (widths.get(entry.target) !== entry.contentRect.width) {
        widths.set(entry.target, entry.contentRect.width); changed = true;
      }
      if (changed) { cancelAnimationFrame(frame); frame = requestAnimationFrame(fitAll); }
    });
    fitAll(); fields.forEach(field => observer.observe(field));
    element.addEventListener('input', fitAll);
    let alive = true;
    void document.fonts.ready.then(() => { if (alive) fitAll(); });
    return () => { alive = false; cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener('input', fitAll); };
  }, [children, hidden]);
  useEffect(() => {
    let interacted = false;
    const input = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,dialog')) return;
      if (event instanceof KeyboardEvent && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return;
      interacted = true;
    };
    const scroll = (event: Event) => {
      const target = event.target;
      const top = target === document ? scrollY : target instanceof HTMLElement && target.matches('.conversation-scroll, .reading-article-pane') ? target.scrollTop : undefined;
      if (top !== undefined && (interacted || top < 40)) setHidden(interacted && top > 40);
    };
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('wheel', input, { passive: true, capture: true });
    document.addEventListener('touchmove', input, { passive: true, capture: true });
    document.addEventListener('keydown', input, true);
    return () => { document.removeEventListener('scroll', scroll, true); document.removeEventListener('wheel', input, true); document.removeEventListener('touchmove', input, true); document.removeEventListener('keydown', input, true); };
  }, []);
  return <header ref={header} className={`conversation-page-header ${hidden ? 'is-compact' : ''}`}>
    {title ? <div className="conversation-toolbar">
      {backHref && <a className="conversation-back" href={backHref} aria-label={`Back to ${backLabel || 'list'}`} title={`Back to ${backLabel || 'list'}`}><ChevronLeft size={19}/><span>{backLabel}</span></a>}
      <h1 className="conversation-compact-title" title={title}>{title}</h1>
      {actions && <div className="conversation-navigation button-row">{actions}</div>}
      <ActionMenu><div className="conversation-header-details" id={detailsId}>{children}{(context || conversation) && <ConversationContributions context={context} conversation={conversation} suggestedTitle={savedTitle || title}/>}<div className="header-secondary-actions"/>{visibilityActions && <div className="page-visibility-actions">{visibilityActions}</div>}</div></ActionMenu>
    </div> : <>{actions}<div className="conversation-header-details">{children}</div></>}
  </header>;
}
