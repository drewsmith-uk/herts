import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot as BotIcon, Eye, EyeOff, LoaderCircle, Pencil, Plus, RefreshCw } from 'lucide-react';
import * as sdk from '@herts/plugin-api/client';
import { Button, ButtonLink, ConversationHeader, ConversationPanel, DialogFrame, DialogHeading, EmptyState, IconButton, ItemList, ItemMeta, ItemRow, PageHeader, SearchField, StatusMessage, pluginLocal, pluginQuery, refresh, useCore, useListState, usePluginRecords, SwipeRow } from '@herts/plugin-api/client';
import type { Bot, BotDetails, ClientPlugin, ConversationContext, RouteProps } from '@herts/plugin-api/client';
import { BotEditor } from './BotEditor';
import { Routines } from './Routines';
import { RecentActions } from './RecentActions';
import { errorText, formatTime, href, ID, useOnlineAction, useSavedDrafts } from './state';
import { DraftList } from './DraftList';
import { ActionRecovery } from './FormRecovery';
import { styles } from './styles';

function Avatar({ bot }: { bot: Bot }) {
  const [image, setImage] = useState<string>();
  useEffect(() => {
    let alive = true; setImage(undefined);
    if (bot.hasAvatar) void pluginQuery(ID, 'avatar', { name: bot.name }).then(value => { if (alive) setImage(value); }).catch(() => {});
    return () => { alive = false; };
  }, [bot.name, bot.hasAvatar]);
  return image ? <img className="bots-avatar" src={image} alt=""/> : <span aria-hidden="true" className="bots-avatar">{bot.title.slice(0, 2).toUpperCase()}</span>;
}

function BotChat({ bot, bots, edit, editing, error, markSeen, hide, hiding }: { bot: Bot; bots: Bot[]; edit(): void; editing: boolean; error: string; markSeen(name: string, at: number): void; hide():void; hiding:boolean }) {
  const core = useCore(), action = useOnlineAction(), [attempt, setAttempt] = useState(0), [opening, setOpening] = useState(false);
  const context = core.snapshot.contexts.find(c => c.botChat && c.profile === bot.name);
  useEffect(() => {
    let alive = true;
    if (!action.online) return;
    setOpening(true);
    void action.run('open', { name: bot.name }).catch(() => {}).finally(() => { if (alive) setOpening(false); });
    return () => { alive = false; };
  }, [bot.name, action.online, attempt]);
  useEffect(() => {
    if (!context) return;
    const seen = () => { if (!document.hidden) markSeen(bot.name, bot.updatedAt); };
    seen(); document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [bot.name, bot.updatedAt, context?.id]);
  return <>
    <ConversationHeader title={bot.title} backHref={href()} backLabel="Bots" context={context} contributionsInDetails actions={<><ButtonLink href={`${href(bot.name)}/routines`}>Routines</ButtonLink><Button disabled={editing} onClick={edit}>{editing ? 'Loading editor…' : 'Edit bot'}</Button></>}>
      <div className="bot-identity"><Avatar bot={bot}/><div><h1>{bot.title}</h1><p className="form-hint">{bot.name}</p></div></div>
      {bot.description && <p className="bot-description">{bot.description}</p>}
      <div className="button-row"><Button disabled={hiding || !action.online} onClick={hide}>{hiding?'Saving…':bot.hidden?'Unhide bot':'Hide bot'}</Button><RecentActions bots={bots} profile={bot.name}/></div>
    </ConversationHeader>
    {(error || action.error) && <StatusMessage>{error || action.error} {!context && <Button disabled={!action.online || opening} onClick={() => setAttempt(n => n + 1)}>Retry opening chat</Button>}</StatusMessage>}
    {!action.online && <StatusMessage tone="notice">{core.online ? 'Hermes is unavailable.' : 'Offline.'} Saved messages and drafts remain available.</StatusMessage>}
    {context ? <ConversationPanel key={context.id} context={{ ...context, title: bot.title }} refreshVersion={bot.updatedAt} showHeading={false} showActions={false}/>
      : opening || action.online && !action.error ? <p className="bots-loading" role="status"><LoaderCircle size={16} className="spin"/> Opening Bot Chat…</p>
      : !action.error && <EmptyState icon={<BotIcon/>} title="Chat not saved on this device" description="Reconnect to open this bot’s existing conversation."/>}
  </>;
}

function BotsPage({ parts }: RouteProps) {
  const core = useCore(), records = usePluginRecords<{ roster?: Bot[]; error?: string }>(ID), bots = records.roster || [];
  let selected = '', invalid = false;
  try { selected = parts[2] ? decodeURIComponent(parts[2]) : ''; invalid = !!selected && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(selected) || parts.length > 7 || !!parts[3] && parts[3] !== 'routines' || !!parts[5] && parts[5] !== 'results'; } catch { invalid = true; }
  const bot = bots.find(b => b.name === selected), editRequest=useRef(0), selection = useRef(selected); selection.current = selected;
  const [search, setSearch] = useListState('bots:query', ''), [hidden, setHidden] = useListState('bots:hidden', false);
  const [editor, setEditor] = useState<{bot?:BotDetails;draftId?:string;warning?:string}>(), [editing, setEditing] = useState(false), [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false), [notice, setNotice] = useState(''), [undo, setUndo] = useState<Bot>(), [hiding,setHiding]=useState(false);
  const action = useOnlineAction('visibility'), drafts=useSavedDrafts('edit:'), local = useRef(pluginLocal(ID)).current, [seen, setSeen] = useState<Record<string, number>>({});
  const seenRef = useRef<Record<string, number>>({});
  useEffect(() => { void local.kv.get('seen').then(row => { seenRef.current = { ...(row?.value || {}), ...seenRef.current }; setSeen(seenRef.current); }).catch(() => {}); }, [local]);
  useEffect(() => { editRequest.current++;setEditor(undefined); setError(''); setEditing(false); }, [selected]);
  function markSeen(name: string, at: number) {
    if ((seenRef.current[name] || 0) >= at) return;
    const next = { ...seenRef.current, [name]: at }; seenRef.current = next; setSeen(next);
    void local.kv.put({ key: 'seen', value: next }).catch(() => {});
  }
  async function edit(target=bot) {
    if (!target || editing) return;
    const bot=target;
    const request=++editRequest.current,name = bot.name; setEditing(true); setError('');
    try {
      let detail: BotDetails;
      let warning='';
      const saved = await local.kv.get(`describe:${name}`), draft = await local.drafts.get(`edit:${name}`);
      try {
        if(!action.online)throw new Error(action.connection);
        detail=await pluginQuery(ID,'describe',{name});
        await local.kv.put({key:`describe:${name}`,value:detail});
      } catch(e) {
        if(!saved&&!draft?.fields)throw new Error('Settings could not be loaded. Reconnect and try again.');
        detail=saved?.value || {...bot,...draft.fields};warning='Showing saved settings. Your draft remains available. '+errorText(e);
      }
      if(request===editRequest.current)setEditor({bot:detail,warning});
    } catch (e) { if (request===editRequest.current) setError(errorText(e)); }
    finally { if (request===editRequest.current) setEditing(false); }
  }
  async function setHiddenBot(row: Bot, hide: boolean) {
    if(hiding||action.locked)return;setHiding(true);setError(''); setNotice('');
    try {
      const detail: BotDetails = await pluginQuery(ID, 'describe', { name: row.name });
      await action.run('configure', { name: row.name, title: detail.title, description: detail.description, revision: detail.revision, hidden: hide });
      await action.acknowledge();setUndo(hide ? row : undefined); setNotice(`${row.title} ${hide ? 'hidden' : 'restored'} in the shared bot roster.`);
    } catch (e) { setError(errorText(e)); } finally {setHiding(false);}
  }
  async function reload() {
    if (refreshing) return;
    setRefreshing(true); setError(''); setNotice(''); action.clearError();
    try { await pluginQuery(ID, 'roster', {}); await refresh(); setNotice('Bots refreshed.'); }
    catch (e) { setError(errorText(e)); }
    finally { setRefreshing(false); }
  }
  const query = search.trim().toLowerCase();
  const visible = bots.filter(b => (hidden || !b.hidden) && `${b.title} ${b.name} ${b.description}`.toLowerCase().includes(query));
  if (invalid) return <><PageHeader title="Invalid bot link" description="This link is incomplete or invalid."/><ButtonLink href={href()}>Back to Bots</ButtonLink></>;
  if (selected && !bot && records.roster) return <><PageHeader title="Bot unavailable" description={!action.online?`${action.connection} This bot is not in the saved roster. Reconnect to check its availability.`:records.error?'The roster could not be refreshed. Try again to check this bot.':'This profile is no longer in the roster.'}/><ButtonLink href={href()}>Back to Bots</ButtonLink><Button disabled={!action.online || refreshing} onClick={() => void reload()}>Refresh bots</Button>{error && <StatusMessage>{error}</StatusMessage>}</>;
  return <div className={`bots ${selected && !parts[3] && bot ? 'bots-chat' : ''}`}>
    {bot ? parts[3] === 'routines' ? <Routines key={bot.name} bot={bot} bots={bots} parts={parts}/> : <BotChat key={bot.name} bot={bot} bots={bots} edit={() => void edit()} editing={editing} error={error} markSeen={markSeen} hide={()=>void setHiddenBot(bot,!bot.hidden)} hiding={hiding}/>
      : <>
        <PageHeader title="Bots" count={records.roster ? visible.length : undefined} description="Your Hermes agents, each with one ongoing conversation." actions={<Button variant="primary" onClick={() => setEditor({draftId:`edit:new:${crypto.randomUUID()}`})}><Plus size={16}/> New bot</Button>}/>
        <DraftList drafts={drafts} open={row=>{const name=row.id.slice(5);if(name==='new'||name.startsWith('new:'))setEditor({draftId:row.id});else {const target=bots.find(b=>b.name===name);if(target)void edit(target);else setError('This bot is not in the saved roster. Refresh the roster to reopen its draft.');}}}/>
        <SearchField label="Search bots" placeholder="Search bots…" value={search} onChange={setSearch}/>
        <div className="bots-toolbar"><label className="bots-filter"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)}/> Show hidden bots</label><div className="button-row"><Button variant="quiet" disabled={!action.online || refreshing} onClick={() => void reload()}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/>{refreshing ? 'Refreshing…' : 'Refresh'}</Button><RecentActions bots={bots}/></div></div>
        {!action.online && <StatusMessage tone="notice">{core.online ? 'Hermes is unavailable.' : 'Offline.'} Showing saved bots. You can open saved chats and continue drafts.</StatusMessage>}
        {(error || action.error || records.error) && <StatusMessage>{error || action.error || records.error}</StatusMessage>}
        {notice && <StatusMessage tone="notice">{notice} {undo && <Button variant="quiet" disabled={!action.online || action.busy} onClick={() => void setHiddenBot(undo, false)}>Undo hide</Button>}</StatusMessage>}
        {!records.roster && action.online && !records.error && <p role="status" className="bots-loading"><LoaderCircle size={16} className="spin"/> Loading bots…</p>}
        <ItemList divided className="bots-roster">{visible.map(b => <SwipeRow key={b.name} busy={editing||hiding||action.busy} disabled={!action.online||action.locked} className={b.hidden?'is-hidden-item':''} left={{label:`${b.hidden?'Unhide':'Hide'} ${b.title}`,icon:b.hidden?<Eye size={20}/>:<EyeOff size={20}/>,run:()=>void setHiddenBot(b,!b.hidden)}} right={{label:'Edit bot',icon:<Pencil size={20}/>,run:()=>void edit(b)}}>
          <ItemRow variant="preview" className="conversation-row" href={href(b.name)} draggable={false} onDragStart={(e:React.DragEvent<HTMLAnchorElement>)=>e.preventDefault()} leading={<Avatar bot={b}/>} trailing={<ArrowRight size={17}/>} aria-label={b.title}>
            <h2 className="item-title">{b.title}</h2><p className="item-preview">{b.preview?.trim()||b.description}</p>
            <ItemMeta>{b.active&&<span>Active now</span>}{b.hidden&&<span>Hidden</span>}{b.updatedAt>(seen[b.name]||0)&&<span>Updated</span>}{b.updatedAt>0&&<span>{formatTime(b.updatedAt)}</span>}</ItemMeta>
          </ItemRow>
        </SwipeRow>)}</ItemList>
        {records.roster && !visible.length && !records.error && <EmptyState icon={<BotIcon/>} title={query ? 'No bots match this search' : bots.length ? 'All bots are hidden' : 'No bots yet'} description={query ? 'Try another name or description.' : bots.length ? 'Show hidden bots to restore one to your roster.' : 'Create a bot to start an ongoing conversation.'}>{query && <Button variant="quiet" onClick={() => setSearch('')}>Clear search</Button>}{!query && bots.length > 0 && <Button onClick={() => setHidden(true)}>Show hidden bots</Button>}</EmptyState>}
      </>}
    <ActionRecovery action={action} review={async()=>{const rows:Bot[]=await pluginQuery(ID,'roster',{});await refresh();const name=action.record?.subject?.profile;const current=name?rows.filter(row=>row.name===name):rows;return current.length?current.map(row=>`${row.title}: ${row.hidden?'Hidden':'Visible'} in the shared roster.`).join('\n'):'The affected bot is no longer listed in Hermes.';}} finish={async()=>{await action.acknowledge();await reload();}}/>
    {editor && <BotEditor key={editor.draftId || editor.bot?.name} {...editor} bots={bots} close={()=>setEditor(undefined)} created={(context:ConversationContext)=>{location.hash=href(context.profile);}}/>}
  </div>;
}
function Screen(props: RouteProps) { return <><style>{styles}</style><BotsPage {...props}/></>; }
export default function activate(): ClientPlugin {
  if (!sdk.MessageAuthor || !sdk.useMessageSpeech || !sdk.reviewPluginAction || !sdk.FormDialog || !sdk.SwipeRow || !sdk.ModelPicker || !sdk.MessageMarkdown || !sdk.useListState || !sdk.DialogHeading) return { tab: { title: 'Bots', path: '/plugins/bots' }, routes: [{ match: p => p.startsWith('/plugins/bots'), component: () => <p>Update Herts through Settings → App updates to use Bots.</p> }] };
  return { tab: { title: 'Bots', path: '/plugins/bots', icon: BotIcon }, routes: [{ match: p => p === '/plugins/bots' || p.startsWith('/plugins/bots/'), component: Screen }], filter: { id: 'linked', label: 'Bot Chats', visible: (conversation, _records, contexts) => !conversation.botChat && !contexts.some(c => c.botChat && c.aliases.includes(conversation.id)) }, ConversationBadge: ({ context, conversation }) => context?.botChat || conversation.botChat ? <span>Bot Chat</span> : null };
}
