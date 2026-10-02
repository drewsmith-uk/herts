# Herts plugin API v1

Develop against the SDK in a Herts source checkout. `@herts/plugin-api/client`, `@herts/plugin-api/server` and `@herts/plugin-api/types` are public import aliases provided by its TypeScript configuration and package builder. They are not currently a published npm package. Prepared output runs without a host rebuild or an npm installation on the receiving server.

Tasks and Reading under `plugins/` are full examples. `examples/notes/` is deliberately independent: it stores notes in its own namespace and embeds core conversations, including other enabled plugins’ actions and link buttons. It is built for tests but is not installed by default.

Use Herts' [shared theme variables](../themes/README.md#plugin-styling) for colours, typography, borders and shadows. Core components and existing shared classes already follow the selected theme; plugin-specific UI should use the same variables to support light, dark and custom themes.

## Start a package

```sh
npm ci
npm run plugin:new -- my-notes
# Edit plugins/my-notes/plugin.json and src/*.tsx / src/*.ts
npx tsc --noEmit
npm run build:plugin -- plugins/my-notes
```

Start a development Herts instance with a separate data directory, then rescan and enable the package in Settings. Each edit requires rebuilding that package, rescanning and applying its update. Restarting the host is unnecessary. Build output shares the host React runtime and SDK; do not ship a second React or import Herts internals.

For an external plugin project, copy it into a development checkout’s plugin directory while building, or pass its folder to `build:plugin` with equivalent TypeScript aliases. Add any build dependencies to that development environment. Ship only `plugin.json`, declared built entry files and required assets. The builder bundles dependencies; libraries with native binaries or filesystem resources need an explicit packaging strategy. It does not copy those resources automatically.

Use a stable unique ID; never reuse another package’s ID to claim its data. The scaffold refuses to overwrite a directory. Source boundary checks run for every package build and reject relative imports into the host or other plugins. This is a development check, not a runtime sandbox.

## Manifest

```json
{
  "id": "my-notes",
  "name": "My Notes",
  "description": "Notes with Hermes conversations",
  "version": "1.0.0",
  "apiVersion": 1,
  "schemaVersion": 1,
  "client": "client.js",
  "server": "server.mjs"
}
```

At least one entry is required. Versions are displayed in Settings; the package content hash identifies a release. Increase `schemaVersion` only when storage needs a migration. Downgrading below the stored schema is refused. The host snapshots prepared code under its private data directory, so changing a source folder cannot silently replace an active version.

Every plugin owns `/plugins/ID/...`. Optional `routes` declares additional top-level prefixes, such as `"/notes"`; those cannot overlap core or another plugin. Use namespace routes for new packages. Optional `shortcuts` contains `{name, description, url}` entries with app-relative `/#/plugins/ID/...` URLs. Only enabled plugin shortcuts appear in the manifest; Android may take time to refresh its launcher metadata.

Entry paths must be relative files inside the package. Browser assets can live in `assets/`; use `new URL('./assets/example.svg', import.meta.url)` in your bundled entry. Prepared JavaScript is served from an immutable same-origin URL and cached for offline use. Do not put secrets in any browser bundle or asset.

## Server entry

Export a default activation function accepting `ServerServices` and returning `ServerPlugin`. See [the interfaces](../sdk/server.ts) for exact signatures.

```ts
import type {ServerServices, ServerPlugin} from '@herts/plugin-api/server';

export default function activate(api: ServerServices): ServerPlugin {
  return {
    migrate(_from, tx) {
      if (!tx.get('settings')) tx.put('settings', {theme: 'plain'});
    },
    commands: {
      save: {
        apply(input, tx) {
          if (typeof input.title !== 'string' || !input.title.trim()) {
            throw Object.assign(new Error('A title is required.'), {statusCode: 400});
          }
          tx.put(`note:${input.id}`, {title: input.title.trim()});
          return {saved: true};
        }
      }
    }
  };
}
```

`get`, `entries`, `transaction`, and `files` are scoped to this plugin and its current reset generation. JSON records are synchronized to clients; keys beginning `private:` are server-only and can be returned through an explicit query when needed. They are not a secrets vault against other trusted plugin code.

Commands have optional asynchronous `prepare(input, api)` and synchronous `apply(input, tx, prepared)`. Validate input before using it. Prepare remote reads outside the transaction. The host commits data and the operation receipt atomically, so reconnecting with the same operation ID and payload returns the prior result. Reusing an ID for a different payload is rejected. Apply must never return a Promise. Migrations also run synchronously in a transaction; a failed migration rolls back its writes and pauses the package. A successfully migrated schema is not automatically downgraded if later startup fails.

Use `api.interval` and `api.onChange` for managed jobs; stop custom resources in `dispose`. Observe `api.signal` during network work. Disabling or resetting aborts the activation and blocks its late storage writes. Transactions from an older reset generation are rejected even after re-enabling. Cleanup and asynchronous activation are time-bounded; trusted synchronous code can still block the process.

`tx.notify` writes a deduplicated notification alongside your data change: `{id, title, body, route, contextId?}`. Use a stable notice ID for each event. Disabled plugin notifications are paused. Notifications and private files are removed by reset. `api.resumed` distinguishes a deliberate re-enable from an ordinary startup; Tasks uses it to combine overdue reminders.

Core context APIs allow read-only conversation resolution, creation of local context records, and canonical linking. `tx.reference(itemId, contextId)` preserves a route/reference back to a core conversation even if the plugin is later unavailable. Resolving, linking or viewing a conversation does not submit work. Server plugins do not receive a special Hermes action endpoint; deliberate messaging uses the shared client conversation panel.

`conversation(context)` can provide a destination/title for core notifications. `conversationList(conversation)` can contribute namespaced filter tags and data. Use `await web.readArticle(url, signal)` for public-page fetching and readable-text extraction. Parsing and sanitisation run in workers with memory/concurrency limits, a five-second processing deadline and retry backoff. The legacy `await web.fetchHtml` / synchronous `web.extractArticle` pair remains supported for installed plugins: the awaited fetch prepares the result in a worker, and extraction accepts only that unmodified HTML/URL pair. Arbitrary synchronous HTML parsing is no longer supported.

## Browser entry

Export a default factory returning `ClientPlugin`. Its exact contribution interfaces are in [pluginContract.ts](../src/pluginContract.ts); public services are exported by [sdk/client.ts](../sdk/client.ts).

The client API also exports the shared UI components in [src/ui.tsx](../src/ui.tsx): `PageHeader`, `Button`, `ButtonLink`, `IconButton`, `SectionNav`, `SectionLink`, `ItemList`, `ItemRow`, `ItemMeta`, `SettingsSection`, `SettingRow`, `FormField`, `EmptyState`, `StatusMessage` and `DialogFrame`. Use them for new plugin screens so typography, spacing, responsive behaviour and theme treatment remain consistent. `Button` defaults to `type="button"`; use `type="submit"` for form submission. `IconButton` requires an accessible label.

`ItemRow` provides leading/content/trailing slots; its default is a card, while `variant="preview"` supports conversation-style lists. An `href` renders a link row; put no interactive children inside a link row. Rows without an `href` render a div and accept a DOM ref and event handlers for plugin-owned drag/drop. Keep mutations, gestures and sorting in the plugin. `SettingsSection` automatically becomes a flat subsection when nested inside another section, including the host's plugin settings container. `FormField` provides an associated label (explicit when `htmlFor` is supplied, otherwise wrapping its input); associate help/error text with the input's `aria-describedby` when present. `DialogFrame` handles native modal focus and Escape; pass `busy` to prevent dismissal while saving, and opt into `dismissOnBackdrop` only where appropriate. It does not submit or save anything.

Older cached app versions may not expose these UI helpers. Check for `PageHeader` in the plugin factory before returning components that use them, and explain that the user can update Herts through Settings → App updates. This keeps recovery available when another device activates an updated plugin before that browser has updated its app shell.

| Contribution | Use |
| --- | --- |
| `tab`, `routes` | Navigation and plugin screens. Match only your manifest routes. |
| `Provider`, `Sidebar` | Shared context and sidebar for your plugin’s active screen. |
| `Settings`, `Conflicts` | Plugin preferences and queued-operation conflict review. |
| `ConversationActions` | Actions shown with the core conversation panel in any view. |
| `ConversationBadge` | Optional status beside each conversation row, derived from your plugin’s current records, including offline changes. |
| `MessageLink` | A button beside a message link; the core already renders the link. |
| `filter` | Optional conversation-list filter, paired with a namespaced server tag. |
| `swipe` | Conversation row action. Multiple contributions open a chooser. `canRunOffline` allows local actions such as opening an existing item. Return a notice with an optional destination link, or navigate directly for an open action. |
| `shares` | Accept shared content and open a review screen. Selection must not send. |
| `reduce`, `reconcile` | Optimistic local records and post-acknowledgement alias handling. |
| `start` | Optional client activation, returning cleanup. |

Conversations excludes linked and manually hidden items by default. The single **Show all** control includes both, bypassing enabled plugins’ conversation filters. To identify linked conversations, use `filter.id: 'linked'`, return `false` from `filter.visible` when your records link to a conversation, and return `filters: ['linked']` from the server's `conversationList` hook for the same conversation. The host combines these filters across enabled plugins and rechecks current records offline. Use `ConversationBadge` to identify the association when the conversation is shown. Filter labels and hidden messages remain available for older hosts; the current host uses the shared control and empty-state message.

Use `usePluginRecords(ID)` to read synchronized records and `mutatePlugin(ID, command, input, contextId?)` to queue changes durably. Include a UUID operation `id`. Pass the associated context ID when a conversation must wait for that queued change before sending. `reduce` must be deterministic, pure and repeatable; conflicting operations remain available for explicit review. `resolvePluginOperation` discards or retries an edit with a new operation identity.

`pluginLocal(ID)` provides namespaced `kv`, `drafts` and `articles` stores for this device. Capture the returned handle before asynchronous work; its reset generation stays fixed. The host clears old local data and rejects stale writes after reset. Save conversation composer drafts through `conversationDrafts`, which is core-owned and survives plugin reset. Use `useEntryDraft` for shared message capture; its unsaved entries are scoped to the plugin generation. Other capture forms can use plugin-local drafts.

Plugin capture drafts must be JSON-serializable. The host keeps a synchronous browser-storage recovery copy until the IndexedDB write completes, so reloading during a pending write preserves the draft. Draft deletion uses the same protection. Recovery never submits a message or creates a task; reset discards recovery copies from earlier plugin generations.

`pluginLocal(ID).hasRecording(owner)` checks whether a plugin's `Voice` capture owner has a saved recording on this device. Use it before removing a capture location, so dictation remains reachable. Older hosts may not expose this helper; feature-detect it and ask for a Herts update before allowing removal.

Embed `<ConversationPanel context={context}/>` for the complete chat experience. Use the canonical context returned by the server; an unsent local item can supply `{id, title, link: null, aliases: []}`. Do not build a separate send loop or automatically resume on mount. The panel preserves unconfirmed submissions and reuses the same Hermes context across every view. It also includes shared session settings (model/provider, effort, fast mode and server folder); edits remain staged until the next Send. New conversations inherit core Herts defaults automatically. Plugins do not need their own settings API or Hermes access.

For detail pages, use `<ConversationHeader title={title} backHref="#/your-list" backLabel="Your list" context={context}>…</ConversationHeader>` above the panel. Its children hold editable titles and page controls; they start collapsed and expand with the details toggle. Back, the title and plugin conversation actions remain accessible. Set `showActions={false}` on the accompanying `ConversationPanel` to avoid duplicating those actions. The panel owns the single activity/Stop row and pending requests beside the composer; the compact row stays outside the history viewport while the user reads. Keep plugin action forms in `DialogFrame` so they do not expand the persistent toolbar.

The panel defaults to showing its Conversation section heading and the first-send explanation for an unlinked item. Use `showHeading={false}` when the entire page is already a conversation. Use `showEmptyNotice={false}` only when the parent supplies the same first-send explanation. These options affect presentation; the composer, history and execution/recovery controls remain available.

`useDraftPersistence`, `useUpdateWork` and `useUpdatePreparation` help save forms before app/plugin changes. Register blockers for active recordings or unfinished forms, and clean up timers/subscriptions. Core voice support uses `Voice`; plugin capture recordings are tagged with the current plugin generation, while conversation recordings remain core-owned.

## Test and release

Run `npm run check`, installer tests and browser tests. Add tests that cover your actual behavior, operation retries, offline edits, disable/re-enable and reset during asynchronous work. Never point these at a production Hermes backend. The included framework tests use temporary directories and synthetic data.

A plugin release must work with the declared API version, retain its stable ID and migrate existing records. Test it with Tasks and Reading both disabled and enabled: core functionality must not depend on them, and shared conversation hooks should appear without cross-plugin imports. Back up before migrating valuable data. Package errors are visible in Settings; do not silently clear data to recover from them.

## Shared message entry

Use `MessageComposer` for text, attachments and dictation. Transcription appends to the editable draft and never sends automatically. Its `Send` action submits the reviewed message through the core receipt workflow; an optional `saveLabel` and `onSaved` provide a separate save-only action. `prepare(draft)` can create the plugin item before either action; make it idempotent using `draft.id`. Save actions remain available offline; Send remains explicit and disabled while offline or unconfirmed.

`useEntryDraft({ key, pluginId, route, ... })` supplies a stable draft/context ID, metadata fields, scoped attachment owner, persistence and completion callbacks for capture adapters. Optional `initialText`/`initialFields` prefill shared content; `legacy` can adopt old plugin drafts and recordings before clearing their old location. A context is retained only after meaningful content, metadata or a recording exists. Pass an explicit `id` to resume a saved capture. Call `complete()` after successfully saving or sending to release the capture slot. Existing core drafts remain available to the saved item's conversation. `entryDraftStatus(pluginId, key)` reports whether that capture slot still contains a draft or recording; check it before deleting its destination.

`ConversationPanel` owns a scrollable history viewport; wrap it in a flex column that can shrink (`min-height: 0`) when embedding it outside the built-in detail screens. `ConversationHeader` keeps the title, back link and contributed actions visible; metadata expands explicitly. Do not add independent window scrolling in conversation contributions.

Lists reached through multiple route aliases can declare a stable `data-list-position` value on a containing element. The shell uses it to restore the same reading position when returning from details.
