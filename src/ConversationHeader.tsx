import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronUp } from 'lucide-react';
import type { Conversation } from '../shared/core';
import type { ConversationContext } from '../shared/conversations';
import { ConversationContributions } from './plugins';

export function ConversationHeader({ children, title, backHref, backLabel, context, conversation, actions, contributionsInDetails = false }: {
  children: ReactNode; title?: string; backHref?: string; backLabel?: string;
  context?: ConversationContext; conversation?: Conversation; actions?:ReactNode; contributionsInDetails?:boolean;
}) {
  const [hidden, setHidden] = useState(true), detailsId = useId();
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
  return <header ref={header} className={`conversation-page-header ${hidden ? 'is-compact' : ''}`}>
    {title && <div className="conversation-toolbar">
      {backHref && <a className="conversation-back" href={backHref} aria-label={`Back to ${backLabel || 'list'}`} title={`Back to ${backLabel || 'list'}`}><ChevronLeft size={19}/><span>{backLabel}</span></a>}
      <span className="conversation-compact-title" title={title}>{title}</span>
      {!contributionsInDetails && (context || conversation) && <ConversationContributions context={context} conversation={conversation} suggestedTitle={title}/>}
      <button className="icon-button conversation-details-toggle" aria-label={hidden ? 'Show page details' : 'Collapse page details'} aria-expanded={!hidden} aria-controls={detailsId} onClick={() => setHidden(value => !value)}>{hidden ? <ChevronDown size={18}/> : <ChevronUp size={18}/>}</button>
    </div>}
    {actions && <div className="conversation-navigation button-row">{actions}</div>}
    <div id={detailsId} className="conversation-header-details" hidden={!!title && hidden}>{children}{contributionsInDetails && (context || conversation) && <ConversationContributions context={context} conversation={conversation} suggestedTitle={title}/>}</div>
  </header>;
}
