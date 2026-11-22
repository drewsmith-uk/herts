import type { ServerPlugin, ServerServices } from '@herts/plugin-api/server';

export default function activate(api: ServerServices): ServerPlugin {
  const voice = api.hermes?.voiceLive;
  if (!voice) throw new Error('Calls requires newer Herts server support. Update the Herts server, then enable Calls.');
  return {
    queries: { status: input => voice.status(input.contextId) },
    actions: { start: (input, effects) => voice.create(input, effects) },
  };
}
