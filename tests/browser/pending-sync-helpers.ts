import type { Page } from '@playwright/test';

export async function seedPendingDraftSettings(page: Page) {
  return page.evaluate(async () => {
    const sdk = (window as any).__HERTS_PLUGIN_RUNTIME__.sdk, db = sdk.conversationDrafts.db;
    const id = crypto.randomUUID(), operationId = crypto.randomUUID();
    const title = 'Review the project arrangements and https://example.com/' + 'long-reference/'.repeat(8);
    await sdk.createLocalConversation(title, id);
    await db.table('drafts').put({ id, text: 'Preserve this unsent draft.', files: [] });
    await db.table('kv').put({ key: `settings-op:${id}`, value: { contextId: id,
      input: { id: operationId, revision: 0, values: { effort: 'high' } } } });
    await sdk.rebuild();
    return { id, operationId, title };
  });
}
