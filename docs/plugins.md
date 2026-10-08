# Plugins

Conversations is the core of Herts and is always enabled. Tasks, Reading and Bots are optional plugins shipped with the app. They use the same public API and lifecycle as third-party plugins. API means application programming interface.

A **new data directory starts with Conversations only**. Open **Settings → Plugins** and tick Tasks or Reading to enable them. An upgrade enables both plugins and keeps the Tasks, Conversations, Reading tab order. It preserves spaces, task order, conversation links, reading items, downloads, and reminders.

## Settings

- **Enable / disable:** applies across devices. Disabling removes the plugin’s tab, screens and conversation contributions and pauses its managed background jobs. Data stays saved. Previously accepted Hermes work and core conversation drafts continue independently.
- **Tab order:** drag rows or use the up/down buttons. Conversations can be moved but cannot be disabled. The first enabled tab opens by default. Mobile navigation fills the width and scrolls horizontally when necessary.
- **Rescan plugins:** discovers prepared folders and detects removals or updates without restarting Herts. Discovery alone does not execute a package or send anything to Hermes.
- **Apply update:** activates a newly discovered package version deliberately. Herts pins the current package until this is selected, including across app restarts.
- **Reset data:** permanently clears that plugin’s records, settings, files, reminders and queued edits. Type its full displayed name to confirm. Conversations, their message drafts and accepted requests are retained. Other plugins are unaffected. Offline devices discard the old plugin data and edits when they reconnect, preventing deleted records from returning.

Tasks returns overdue snoozes to Inbox when enabled again. Reminders that became due while Tasks was disabled produce one catch-up notification. A group notification opens a list of the returned tasks. Reading pauses downloads while disabled and resumes eligible downloads when enabled again.

Plugin changes require a server connection. Existing enabled screens and saved data remain usable offline. Devices learn about disable/reset operations on reconnection. A device can have an active recording or an unfinished form. It can ask you to finish or save this work before it changes the local plugin screen. The server has already paused the disabled plugin.

## Add a prepared package

The default directory is `plugins/` in the Herts checkout. Each direct child folder contains `plugin.json`, a prepared browser module, an optional prepared server module, and any assets. The included plugins are built by `npm run build`.

The build also generates `THIRD_PARTY_NOTICES.txt` from the dependencies included in each package. Keep it alongside the prepared modules when sharing or installing packages. Rebuild notices whenever dependencies change; package authors remain responsible for licences of any manually supplied assets or fonts.

```text
plugins/
  tasks/plugin.json
  tasks/client.js
  tasks/server.mjs
  reading/...
  my-plugin/plugin.json
  my-plugin/client.js
  my-plugin/server.mjs
  my-plugin/assets/...
```

Copy a **prepared release** into its own folder, then select **Settings → Plugins → Rescan plugins**. It appears disabled. Tick it to activate. Herts marks a source folder as invalid if declared built files are missing. A rescan does not install npm dependencies or compile arbitrary source.

Set `HERTS_PLUGINS_DIR` to an absolute path to use another directory. The installer accepts `--plugins-dir`. If you override it, also copy the prepared Tasks and Reading folders there if you want them available. Keep the directory readable by the service user. Added third-party folders and generated bundles are ignored by this repository’s Git rules.

To update a plugin, replace its prepared folder. Rescan the plugin directory. Select **Apply update**. To remove it, delete its folder and rescan. Removing a package disables it and retains its data. Restoring a folder with the **same stable plugin ID** makes the data available again after you enable it. Changing an ID creates a different namespace. You can reset retained data even while the package is absent.

Herts rejects duplicate IDs, incompatible API versions, conflicting routes, missing entry files and symlinks in prepared packages. Errors appear in Settings. A failing plugin is paused and its data retained; core Conversations remains available. These checks are reliability measures, not a security sandbox.

## Trust and privacy

Only install plugins you trust. Server plugins are code running as the Herts server user; browser plugins run in the authenticated app origin. They can access private conversations and have the same effective trust as the app. The SDK supplies scoped storage and managed lifecycle services, but does not isolate hostile code. There is no remote plugin marketplace, automatic package download, or permission elevation for the bundled plugins.

Keep private data in the SDK storage APIs rather than inside package folders. The backup script includes the plugin inventory, retained package versions and plugin-owned files alongside the database. The package source directory should also be backed up if you develop plugins locally. Do not publish private plugin configuration or data in release bundles.

## Sharing and conversations

Android has one Herts share target. When several enabled destinations accept the content, Herts asks where to send it. Choosing a destination sends nothing by itself. Core Conversations prepares a message draft. Tasks saves a task with a draft. Reading offers link review with explicit **Add & send** or offline **Save link** actions.

Plugins embed the core conversation panel. That panel provides history, timestamps, activity, drafts, attachments, voice, approvals, stop controls and contributions from other enabled plugins. For example, a Reading conversation still offers Make a task when Tasks is enabled. Bookmarking does not make a conversation count as task-linked. Disabling a plugin never resumes or stops Hermes.

See [the authoring guide](plugin-api.md) to build your own plugin, and [the Notes example](../examples/notes/src/client.tsx) for a small independent package.

## Bots and external work

[Bots](bots.md) exposes profiles, permanent chats and routines on the existing Hermes backend. It is initially disabled on both new and upgraded installations. Its remote actions require connectivity and use durable receipts, separately from queued offline metadata edits. Disabling or resetting it never deletes Hermes profiles or stops Hermes routines. Cached bot records and form drafts are plugin-owned; conversation contexts, drafts, accepted sends and remote-action receipts survive reset.
