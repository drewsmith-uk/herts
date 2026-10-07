import { SwipeRow } from './SwipeRow';
import { type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, Plus } from 'lucide-react';
import type { Conversation } from '../shared/core';
import { ItemRow, ItemMeta } from './ui';

export function ConversationRow({ conversation: c, updatedAt, online, busy, onAction, actionLabel, badges, canActOffline }: {
  conversation: Conversation; updatedAt: string; online: boolean; busy: boolean; actionLabel?:string;badges?:ReactNode;canActOffline?:boolean;
  onAction: (kind: 'plugin' | 'visibility') => Promise<void>;
}) {
  const canAct = !busy && !!actionLabel && (online || canActOffline);
  return <SwipeRow className={c.hidden ? 'is-hidden-item' : ''} data-conversation-key={c.key} busy={busy}
    left={{label:c.hidden?'Unhide':'Hide',icon:c.hidden?<Eye size={20}/>:<EyeOff size={20}/>,run:()=>void onAction('visibility')}}
    right={canAct?{label:actionLabel!,icon:<Plus size={20}/>,run:()=>void onAction('plugin')}:undefined}>
      <ItemRow variant="preview" className="conversation-row" draggable={false} onDragStart={e => e.preventDefault()} href={`#/conversation/${encodeURIComponent(c.key)}`}
        trailing={busy ? <LoaderCircle size={17} className="spin"/> : <ArrowRight size={17}/>}>
        <h2 className="item-title">{c.title}</h2>{c.preview?.trim() && <p className="item-preview">{c.preview}</p>}<ItemMeta><span>{c.source}</span><span>{updatedAt}</span>{badges}{c.hidden && <span className="hidden-item-badge"><EyeOff size={12}/>Hidden</span>}</ItemMeta>
      </ItemRow>
  </SwipeRow>;
}
