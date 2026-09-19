// Compatibility adapter for pre-plugin APIs, stored operations and migration tests.
// Runtime plugin packages use only the public SDK and never receive this class.
import type Database from 'better-sqlite3';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {applyTaskOp,applySpaceOp,withSpaces,emptySnapshot,Conflict,type Snapshot,type TaskOp,type SpaceOp,type Task,type Link} from '../shared/model.js';
import {applyReadingOp,emptyReading,normalizeUrl,retainsArticle,type ConversationContext,type ReadingOp,type ReadingState,type Article} from '../shared/reading.js';
export abstract class LegacyFeatures extends EventEmitter {
  abstract db:Database.Database;
  abstract getMeta<T=any>(key:string):T|undefined;
  abstract setMeta(key:string,value:unknown):void;
  abstract contexts():ConversationContext[];
  abstract context(id:string):ConversationContext|undefined;
  abstract saveContext(context:ConversationContext):ConversationContext;
  abstract ensureContext(link:Link,aliases?:string[],preferred?:string):ConversationContext;
  abstract bumpRevision():void;
  abstract receipt(id:string,payload:unknown):any;
  abstract saveReceipt(id:string,payload:unknown,data:unknown):void;
  updateLegacyLinks(contextId:string,link:Link){if(!this.getMeta('plugin-data-migrated'))for(const task of this.snapshot().tasks.filter(t=>t.contextId===contextId)){task.link=link;this.saveTask(task);}}
  snapshot(): Snapshot {
    const plugin = this.pluginRecord<Snapshot>('tasks','state');
    const base = plugin || { ...this.getMeta<Omit<Snapshot,'tasks'>>('snapshot')!, tasks:(this.db.prepare('SELECT data FROM tasks').all() as any[]).map(r=>JSON.parse(r.data)) };
    return withSpaces({ ...base, revision:this.getMeta<any>('snapshot').revision, hiddenConversations:this.getMeta<string[]>('hiddenConversations')||[], contexts:this.contexts(), reading:this.reading(), tasks:base.tasks.map(t=>({...t,link:(t.contextId&&this.contexts().find(c=>c.id===t.contextId)?.link)||t.link})) });
  }
  pluginRecord<T>(id:string,key:string):T|undefined {
    if(!this.db.prepare("SELECT name FROM sqlite_master WHERE name='plugin_records'").get())return undefined;
    const row=this.db.prepare('SELECT data FROM plugin_records WHERE plugin_id=? AND key=?').get(id,key) as any;
    return row?JSON.parse(row.data):undefined;
  }
  setPluginRecord(id:string,key:string,value:unknown){this.db.prepare('INSERT INTO plugin_records VALUES (?,?,?) ON CONFLICT(plugin_id,key) DO UPDATE SET data=excluded.data').run(id,key,JSON.stringify(value));}

  task(id: string): Task | undefined { const state=this.pluginRecord<Snapshot>('tasks','state'); if(state){const task=state.tasks.find(t=>t.id===id);return task?{...task,link:this.contexts().find(c=>c.id===task.contextId)?.link||task.link}:undefined;} const r = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id) as any; return r && JSON.parse(r.data); }
  saveTask(task: Task) { const state=this.pluginRecord<Snapshot>('tasks','state');if(state){const i=state.tasks.findIndex(t=>t.id===task.id);if(i<0)state.tasks.push(task);else state.tasks[i]=task;this.setPluginRecord('tasks','state',state);return;}this.db.prepare('INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET link_key=excluded.link_key,data=excluded.data').run(task.id, task.link?.key || null, JSON.stringify(task)); }
  saveTaskState(snapshot: Snapshot) {
    const { lists, revision, spaces, spaceLists, defaultSpaceId } = withSpaces(snapshot);
    const plugin=this.pluginRecord<Snapshot>('tasks','state');if(plugin)this.setPluginRecord('tasks','state',{...plugin,lists,revision,spaces,spaceLists,defaultSpaceId});
    this.setMeta('snapshot', { lists, revision, spaces, spaceLists, defaultSpaceId });
  }
  mutateSpace(op: SpaceOp) {
    const result = this.db.transaction(() => {
      const prior = this.receipt(op.id, op); if (prior) return prior;
      this.saveTaskState(applySpaceOp(this.snapshot(), op));
      const result = { accepted: true, id: op.id }; this.saveReceipt(op.id, op, result); return result;
    })(); this.emit('change', { type: 'spaces' }); return result;
  }
  mutate(op: TaskOp) {
    const result = this.db.transaction(() => {
      const prior = this.receipt(op.id, op); if (prior) return prior;
      const next = applyTaskOp(this.snapshot(), op);
      const task = next.tasks.find(t => t.id === op.taskId)!;
      if (!task.contextId) task.contextId = task.id;
      const context = this.context(task.contextId);
      if (!context || !context.link) this.saveContext({ id: task.contextId, title: task.title, link: null, aliases: [] });
      this.saveTask(task);
      this.saveTaskState(next);
      const result = { accepted: true, id: op.id }; this.saveReceipt(op.id, op, result); return result;
    })();
    this.emit('change', { type: 'tasks' }); return result;
  }
  wakeSnoozed(now = Date.now()) {
    const woke = this.db.transaction(() => {
      let snapshot = this.snapshot();
      const due = snapshot.tasks.filter(t => t.status === 'snoozed' && t.snoozedUntil && t.snoozedUntil <= now).sort((a,b) => a.snoozedUntil! - b.snoozedUntil! || a.id.localeCompare(b.id));
      for (const task of due) {
        snapshot = applyTaskOp(snapshot, { id: randomUUID(), taskId: task.id, kind: 'move', status: 'inbox', baseStatus: 'snoozed', spaceId: task.spaceId, baseSpaceId: task.spaceId, baseSnoozeId: task.snoozeId, at: now });
        this.saveTask(snapshot.tasks.find(t => t.id === task.id)!);
        // Persist the return and its one reminder together. Startup recovery and
        // a lost sync receipt cannot produce another reminder for this snooze.
        this.db.prepare('INSERT OR IGNORE INTO notices VALUES (?,?,?,?)').run(`snooze:${task.id}:${task.snoozeId}`, task.id, 'reminder', now);
      }
      if (due.length) this.saveTaskState(snapshot);
      return due.length;
    })();
    if (woke) { this.emit('change', { type: 'tasks' }); this.emit('notice'); }
    return woke;
  }
  createLinked(op: TaskOp, link: Link, aliases: string[] = []) {
    return this.db.transaction(() => {
      const prior = this.receipt(op.id, { op, linkKey: link.key }); if (prior) return prior;
      const context = this.ensureContext(link, aliases, op.taskId);
      const existing = this.snapshot().tasks.find(t => t.contextId === context.id || t.link?.key === link.key);
      if (existing) throw new Conflict(`This conversation already belongs to task ${existing.id}.`);
      const next = applyTaskOp(this.snapshot(), op);
      const task = next.tasks.find(t => t.id === op.taskId)!; task.link = link; task.contextId = context.id;
      this.saveTask(task); this.saveTaskState(next);
      const result = { taskId: task.id }; this.saveReceipt(op.id, { op, linkKey: link.key }, result);
      this.emit('change', { type: 'tasks' }); return result;
    })();
  }
  reading(): ReadingState { const plugin=this.pluginRecord<ReadingState>('reading','state'); if(plugin)return plugin; return { ...emptyReading(), ...this.getMeta('reading'), items: (this.db.prepare('SELECT data FROM reading_items').all() as any[]).map(r => JSON.parse(r.data)) }; }
  readingMutation(op: ReadingOp, conversation?: { link: Link; aliases: string[] }) {
    const result = this.db.transaction(() => {
      const prior = this.receipt(op.id, op); if (prior) return prior;
      let actual = op;
      if (op.kind === 'create') {
        let context: ConversationContext;
        if (op.conversationId) {
          if (!conversation) {
            context = this.contexts().find(c => c.aliases.includes(op.conversationId!))!;
            if (!context) throw new Conflict('Connect to Hermes to save this conversation link.');
          } else context = this.ensureContext(conversation.link, conversation.aliases, op.contextId);
        } else {
          if (!op.contextId || this.context(op.contextId)) throw new Conflict('Conversation reference already exists.');
          context = this.saveContext({ id: op.contextId, title: op.title?.trim() || op.url!, link: null, aliases: [] });
        }
        actual = { ...op, contextId: context.id };
        const existing = this.reading().items.find(i => i.contextId === context.id && i.urlKey === normalizeUrl(op.url!));
        if (existing) { const result = { accepted: true, itemId: existing.id }; this.saveReceipt(op.id, op, result); return result; }
      }
      const next = applyReadingOp(this.reading(), actual);
      if(this.pluginRecord('reading','state')){this.setPluginRecord('reading','state',next);for(const item of next.items)if(!retainsArticle(item,next)||this.article(item.id)?.version!==item.downloadVersion)this.db.prepare('DELETE FROM plugin_records WHERE plugin_id=? AND key=?').run('reading',`private:article:${item.id}`);}else this.setMeta('reading', { unread: next.unread, autoDownload: next.autoDownload });
      for (const item of next.items) {
        if(this.pluginRecord('reading','state'))continue;
        this.db.prepare('INSERT INTO reading_items VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, item.contextId, item.urlKey, JSON.stringify(item));
        if (!retainsArticle(item, next) || this.article(item.id)?.version !== item.downloadVersion) this.db.prepare('DELETE FROM articles WHERE item_id=?').run(item.id);
      }
      this.bumpRevision();
      const result = { accepted: true, itemId: op.itemId }; this.saveReceipt(op.id, op, result); return result;
    })(); this.emit('change', { type: 'reading' }); return result;
  }
  article(id: string): Article | undefined { const plugin=this.pluginRecord<Article>('reading',`private:article:${id}`); if(plugin)return plugin; const r = this.db.prepare('SELECT data FROM articles WHERE item_id=?').get(id) as any; return r && JSON.parse(r.data); }
  saveArticle(article: Article) {
    const reading = this.reading(), item = reading.items.find(i => i.id === article.itemId);
    if (!item || !retainsArticle(item, reading) || item.downloadVersion !== article.version) return false;
    if(this.pluginRecord('reading','state'))this.setPluginRecord('reading',`private:article:${item.id}`,article);else this.db.prepare('INSERT OR REPLACE INTO articles VALUES (?,?)').run(item.id, JSON.stringify(article));
    if (article.title && item.title === item.url) { item.title = article.title.slice(0, 2000); if(this.pluginRecord('reading','state'))this.setPluginRecord('reading','state',reading);else this.db.prepare('UPDATE reading_items SET data=? WHERE id=?').run(JSON.stringify(item), item.id); this.bumpRevision(); }
    this.emit('change', { type: 'article' }); return true;
  }
  notificationRoute(id: string) {
    const context = this.context(id), contextId = context?.id || id;
    const task = this.snapshot().tasks.find(t => t.contextId === contextId);
    const item = this.reading().items.find(i => i.contextId === contextId);
    return task ? `/task/${task.id}` : item ? `/reading-item/${item.id}` : context?.link ? `/conversation/${encodeURIComponent(context.link.key)}` : '/reading';
  }
}
