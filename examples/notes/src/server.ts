import type { ServerServices, ServerPlugin } from '@herts/plugin-api/server';
export default function activate(api: ServerServices): ServerPlugin {
    return {
        migrate(_from, tx) {
            if (!tx.get('settings'))
                tx.put('settings', { description: 'My notes' });
        },
        commands: {
            save: {
                async prepare(input) {
                    if (input.conversationId)
                        return api.resolveConversation(input.conversationId);
                },
                apply(input, tx, conversation) {
                    if (typeof input.id !== 'string' || typeof input.title !== 'string' || !input.title.trim()) {
                        throw Object.assign(new Error('A note ID and title are required.'), { statusCode: 400 });
                    }
                    const prior = tx.get<{
                        contextId: string;
                    }>(`note:${input.id}`);
                    const context = prior ? tx.context(prior.contextId)! : conversation
                        ? tx.ensureContext(conversation)
                        : tx.createContext({ id: input.id, title: input.title, link: null, aliases: [] });
                    const note = { id: input.id, title: input.title.trim(), contextId: context.id };
                    tx.reference(input.id, context.id);
                    tx.put(`note:${input.id}`, note);
                    return note;
                },
            },
        },
    };
}
