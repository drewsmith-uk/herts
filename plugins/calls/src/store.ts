import * as sdk from '@herts/plugin-api/client';
import type { ConversationContext, VoiceLiveSession } from '@herts/plugin-api/types';
import { CallController, isLive, SetupError, type CallRecord } from './controller';
import { acquireCallLock, BrowserTransport } from './transport';

import { ConnectionSound } from './sound';

const ID = 'calls';
export const callRoute = (contextId: string) => `/plugins/calls/${encodeURIComponent(contextId)}`;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createCallStore() {
  const local = sdk.pluginLocal(ID), notifications = sdk.pluginNotifications<{ callId: string }>(ID);
  let state = { record: undefined as CallRecord | undefined, loaded: false, error: '', notificationError: '', notices: false, sounds: true };
  const sound = new ConnectionSound();
  let beginning = false;
  const listeners = new Set<() => void>();
  let stopped = false, noticeSignature = '', noticeWork = Promise.resolve();
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  function notice(record?: CallRecord) {
    if (stopped) return;
    const visible = state.notices && record && ['active', 'closing', 'unconfirmed'].includes(record.state);
    const signature = `${visible ? record.id + ':' + record.state : 'none'}`;
    if (signature === noticeSignature) return;
    noticeSignature = signature;
    noticeWork = noticeWork.catch(() => {}).then(async () => {
      if (signature !== noticeSignature || stopped) return;
      const old = (await notifications.list()).find(row => row.key === 'call');
      if (!visible) { if (old) await notifications.remove('call'); return; }
      if (!(await notifications.ready())?.windowOwnership) throw new Error('Update Herts through Settings → App updates to use call notifications.');
      const saved = await notifications.set({ key: 'call',
        title: record.state === 'active' ? 'Call in progress' : 'Check call status', body: 'Tap to return to Herts',
        route: callRoute(record.contextId), metadata: { callId: record.id }, restoreOnDismiss: false,
        ownerWindow: true, inactiveTitle: 'Check call status',
      }, old?.revision || null);
      if (saved.displayError) throw new Error(saved.displayError);
      publish({ notificationError: '' });
    }).catch(error => publish({ notificationError: error instanceof Error ? error.message : 'Call notification failed. Select Retry notification.' }));
  }
  const controller = new CallController({
    greeting: sdk.voiceLiveGreeting,
    id: () => crypto.randomUUID(), acquire: acquireCallLock,
    transport: (event, lost) => new BrowserTransport(event, lost),
    changed: record => { if (record.state !== 'starting') sound.stop(); publish({ record }); notice(record); },
    save: async record => {
      await local.kv.put({ key: `call:${record.id}`, value: record });
      await local.kv.put({ key: 'latest', value: record.id });
    },
    create: async (sdp, call): Promise<VoiceLiveSession> => {
      let action;
      try { action = await sdk.performPluginAction(ID, 'start', { contextId: call.contextId, sdp }, call.id); }
      catch { /* Read the receipt after a lost reply. Never repeat session creation. */ }
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (action?.state === 'finished') return action.result;
        if (action?.state === 'failed' || action?.state === 'unknown')
          throw new SetupError(action.error || 'Call setup failed. Check Hermes before retrying.', action.state === 'unknown');
        if (stopped || !isLive(controller.record?.state)) break;
        await delay(300);
        try { action = await sdk.pluginActionStatus(ID, call.id); } catch { /* Receipt reads can be repeated safely. */ }
      }
      throw new SetupError('Call setup was not confirmed. Review its status before starting another call.', true);
    },
    submit: (call, request) => sdk.submit({ id: request.actionId, contextId: call.contextId, kind: 'send', text: request.text,
      voice: { callId: call.id, delegationId: request.id, context: request.context } }),
  });
  async function load() {
    try {
      state.notices = (await local.kv.get('notices'))?.value === true;
      state.sounds = (await local.kv.get('sounds'))?.value !== false;
      const latest = await local.kv.get('latest');
      const saved: CallRecord | undefined = latest && (await local.kv.get(`call:${latest.value}`))?.value;
      if (saved && !stopped) {
        let release: (() => void) | undefined;
        try { release = await acquireCallLock(); await controller.restore(saved); }
        catch { publish({ error: 'A call may be open in another Herts window. Return there to check its status.' }); }
        finally { release?.(); }
      }
      if (!stopped) publish({ loaded: true });
    } catch { if (!stopped) publish({ loaded: true, error: 'Call recovery could not be loaded. Reload Herts before starting a call.' }); }
  }
  return {
    controller,
    get: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      stopped = false; void load();
      const changed = () => {
        const core = sdk.getCore();
        controller.observe(core.actions);
        if (!core.online || !core.gateway.online) { sound.stop(); controller.end(false, 'connection'); }
      };
      const core = sdk.subscribeCore(changed); changed();
      const hidden = () => { if (document.visibilityState === 'hidden') { sound.stop(); controller.end(false, 'background'); } };
      const freeze = () => { sound.stop(); controller.end(true, 'background'); };
      const offline = () => { sound.stop(); controller.end(false, 'connection'); };
      document.addEventListener('visibilitychange', hidden);
      document.addEventListener('freeze', freeze);
      window.addEventListener('pagehide', freeze);
      window.addEventListener('offline', offline);
      return () => {
        stopped = true; sound.stop(); controller.dispose(); core();
        document.removeEventListener('visibilitychange', hidden); document.removeEventListener('freeze', freeze);
        window.removeEventListener('pagehide', freeze); window.removeEventListener('offline', offline);
      };
    },
    async begin(context: ConversationContext) {
      if (!state.loaded || !context.link || beginning || isLive(controller.record?.state)) return;
      beginning = true;
      publish({ error: '' });
      if (state.sounds) sound.start();
      try { await controller.start(context); }
      catch (error) { publish({ error: error instanceof Error ? error.message : 'The call could not start. Retry.' }); }
      finally { beginning = false; if (state.record?.state !== 'starting') sound.stop(); }
    },
    async setSounds(value: boolean) {
      await local.kv.put({ key: 'sounds', value });
      publish({ sounds: value });
      if (!value) sound.stop();
    },
    async permit() {
      const permission = await notifications.requestPermission();
      if (permission !== 'granted') { publish({ notificationError: 'Allow notifications in Chrome settings, then retry. Calls remain available.' }); return; }
      await local.kv.put({ key: 'notices', value: true }); publish({ notices: true, notificationError: '' });
      noticeSignature = ''; notice(state.record);
    },
    async disableNotices() {
      await local.kv.put({ key: 'notices', value: false }); publish({ notices: false, notificationError: '' });
      noticeSignature = ''; notice(state.record);
    },
    retryNotice() { noticeSignature = ''; notice(state.record); },
    async prepareUpdate() {
      sound.stop(); controller.end(false, 'update');
      const deadline = Date.now() + 15_000;
      while (isLive(controller.record?.state) && Date.now() < deadline) await delay(100);
      if (isLive(controller.record?.state)) controller.end(true);
      await controller.flush(); await noticeWork;
    },
  };
}
export type CallStore = ReturnType<typeof createCallStore>;
