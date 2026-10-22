import { randomUUID } from 'node:crypto';
import { Conflict } from '../shared/core.js';
import { Gateway, GatewayError } from './gateway.js';
import { Store } from './store.js';

interface TitleEdit {
  contextId: string; sessionId: string; profile: string; title: string; baseTitle: string;
  requestId: string; revision?: number; state: 'prepared' | 'unknown' | 'confirmed' | 'rejected';
}

export class TitleEdits {
  private active = new Set<string>();
  constructor(private store: Store, private gateway: Gateway) {}
  async rename(contextId: string, sessionId: string, title: string, baseTitle: string, requestId: string = randomUUID()) {
    if (this.active.has(contextId)) throw new Conflict('A title change is pending. Wait before saving again.');
    this.active.add(contextId);
    try {
      const key = `title-edit:${requestId}`;
      const profile = this.gateway.profile;
      let edit = this.store.getMeta<TitleEdit>(key);
      if (edit && [edit.contextId, edit.sessionId, edit.profile, edit.title, edit.baseTitle].join('\0') !==
          [contextId, sessionId, profile, title, baseTitle].join('\0')) throw new Conflict('An operation ID cannot be reused for different content.');
      if (edit?.state === 'rejected') throw Object.assign(new GatewayError('The title change was refused. Reopen the editor and review the current title.'), { operationRejected: true });
      const snapshot = await this.gateway.mutationSnapshot(sessionId);
      const current = await this.gateway.sessionDetail(sessionId);
      if (current.title === title) {
        if (edit) this.store.setMeta(key, { ...edit, state: 'confirmed' });
        return;
      }
      if (edit?.state === 'unknown') throw new GatewayError('The title change remains unconfirmed. Refresh the conversation before making another edit.', true);
      if (edit?.state === 'confirmed') throw new Conflict('The title changed after this edit. Refresh and review the current title.');
      const shownTitle = current.title || current.preview?.slice(0, 80) || 'Untitled conversation';
      if (shownTitle !== baseTitle && !(!current.title && baseTitle === 'Conversation')) throw new Conflict('The title changed in Hermes. Reopen the editor and review the current title.');
      edit = { contextId, sessionId, profile, title, baseTitle, requestId, revision: snapshot.runtime_revision, state: 'unknown' };
      this.store.setMeta(key, edit);
      try {
        await this.gateway.renameConversation(sessionId, title, requestId, snapshot.runtime_revision);
        this.store.setMeta(key, { ...edit, state: 'confirmed' });
      } catch (error) {
        if (error instanceof GatewayError && !error.uncertain) { this.store.setMeta(key, { ...edit, state: 'rejected' }); error.operationRejected = true; }
        throw error;
      }
    } finally { this.active.delete(contextId); }
  }
}
