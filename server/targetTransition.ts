import { realpath } from 'node:fs/promises';
import { parseConversationRef } from '../shared/conversations.js';
import { Gateway } from './gateway.js';
import type { NativeGatewayOptions } from './nativeGateway.js';
import { Store, digest } from './store.js';

export async function transitionToGateway(store: Store, old: Gateway, options: NativeGatewayOptions, apply = false) {
  if (store.actions().some(action => action.receipt === 'pending' || ['preparing', 'running', 'awaiting_input', 'stopping'].includes(action.state)))
    throw new Error('Finish active Herts work before switching connections.');
  const home = await realpath(options.home), profile = old.defaultProfile;
  const previous = store.getMeta<{ base: string; profile: string }>('hermesTarget');
  const target = { base: `gateway:${home}`, profile };
  if (!previous || previous.base !== old.base || previous.profile !== profile)
    throw new Error('The configured standalone target does not match this data directory.');
  const fingerprint = () => digest({ contexts: store.contexts(), bindings: store.bindings(), actions: store.actions(), hidden: store.coreSnapshot().hiddenConversations });
  const before = fingerprint();
  const gateway = new Gateway('', '', [], () => [], profile, { ...options, home });
  try {
    await gateway.connect();
    const [oldStatus, nextStatus] = await Promise.all([old.http('/api/status'), gateway.http('/api/status')]);
    if (!oldStatus.install_id || oldStatus.install_id !== nextStatus.install_id)
      throw new Error('The gateway installation does not match the standalone installation.');
    const ids = new Set(store.contexts().flatMap(context => context.link ? [context.link.storedId, ...context.aliases] : []));
    for (const [, binding] of store.bindings()) ids.add(binding.storedId);
    for (const id of store.coreSnapshot().hiddenConversations || []) ids.add(id);
    for (const id of ids) {
      const scoped = parseConversationRef(id).profile || profile;
      const [source, destination] = await Promise.all([
        old.withProfile(scoped, () => old.sessionDetail(id)), gateway.withProfile(scoped, () => gateway.sessionDetail(id)),
      ]);
      const identity = (row: any) => [row.id, row.profile, row.source, row.started_at];
      if (source.started_at == null || digest(identity(source)) !== digest(identity(destination)))
        throw new Error('A saved conversation does not match the gateway. The target was not changed.');
    }
    if (apply) store.db.transaction(() => {
      if (before !== fingerprint() || digest(previous) !== digest(store.getMeta('hermesTarget')))
        throw new Error('Saved work changed during verification. Stop Herts and repeat the check.');
      store.setMeta('hermesTargetTransition', { previous, target, verifiedAt: Date.now(), conversations: ids.size });
      store.setMeta('hermesTarget', target);
      for (const [id, binding] of store.bindings()) store.saveBinding(id, { ...binding, ready: false, known: false });
    })();
    return { applied: apply, conversations: ids.size, profile };
  } finally { gateway.close(); }
}
