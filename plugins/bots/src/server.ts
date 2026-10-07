import type { ServerServices, ServerPlugin } from '@herts/plugin-api/server';
import type { Bot, RoutineInput } from '@herts/plugin-api/types';
export default function activate(api: ServerServices): ServerPlugin {
  const hermes = api.hermes;
  if (!hermes?.routineSpeech) throw new Error('Bots requires newer Herts server support. Install the latest Herts server and restart its app service, then enable Bots again. Settings → App updates only updates the browser app.');
  let loading: Promise<Bot[]> | undefined;
  const refresh = () => loading ||= (async () => {
    try {
      const bots = await hermes.bots();
      if (!api.signal.aborted) api.transaction(tx => {
        if (JSON.stringify(tx.get('roster')) !== JSON.stringify(bots)) tx.put('roster', bots);
        if (tx.get('error')) tx.delete('error');
      });
      return bots;
    } catch (error) {
      if (!api.signal.aborted) api.transaction(tx => tx.put('error', (error as Error).message));
      throw error;
    } finally { loading = undefined; }
  })();
  return {
    start() {
      let dirty = false;
      const dispose = hermes.onChange?.(() => { dirty = true; });
      if (dispose) api.signal.addEventListener('abort', dispose, { once: true });
      void refresh().catch(() => {});
      api.interval(() => refresh().then(() => {}, () => {}), 10000);
      api.interval(async () => { if (dirty) { dirty = false; await refresh().catch(() => {}); } }, 1000);
    },
    queries: {
      roster: refresh,
      describe: input => hermes.describeBot(input.name),
      avatar: input => hermes.botAvatar(input.name),
      models: input => hermes.models(input.name),
      routines: input => hermes.routines(input.profile),
      speak: input => hermes.routineSpeech(input.profile,input.id,input.run,input.offset,input.index),
      runs: input => hermes.routineRuns(input.profile, input.id),
      result: input => hermes.routineResult(input.profile, input.id, input.run, input.offset),
    },
    actions: {
      open: async (input, effects) => { const result = await hermes.openBot(input.name, effects); await refresh().catch(() => {}); return result; },
      create: async (input, effects) => { const result = await hermes.createBot(input, effects); await refresh().catch(() => {}); return result; },
      configure: async (input, effects) => { await hermes.configureBot(input, effects); await refresh().catch(() => {}); },
      routine: async (input: RoutineInput & { action: 'create' | 'update' | 'pause' | 'resume' | 'remove' | 'run' }, effects) => {
        const { action, ...value } = input;
        if (!['create', 'update', 'pause', 'resume', 'remove', 'run'].includes(action)) throw new Error('Unknown routine action.');
        return hermes.changeRoutine(action, value, effects);
      },
    },
    conversationList: conversation => conversation.botChat ? { filters: ['linked'] } : {},
    conversation: context => context.botChat && context.profile ? { route: `/plugins/bots/${context.profile}`, title: context.title } : undefined,
  };
}
