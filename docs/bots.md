# Bots

Enable **Bots** in **Settings → Plugins** after rebuilding Herts and restarting its app service. It connects to the same Hermes backend as Conversations and lists that backend’s profiles. Herts requires no additional connection or provider credentials.

**Settings → App updates** refreshes the browser app; it does not restart the Herts server. The plugin catalogue discovers packages from disk, so Bots can appear while an older server is still running. If enabling Bots reports missing server support, finish the Herts server upgrade. Restart the existing Herts app service. Older installations can call it `hermes-tasks.service`. Then enable Bots again. The Hermes backend does not need restarting for this step.

Each bot opens its existing permanent **Bot Chat**, including history shared with Hermes Desktop. Opening a bot does not send a message. If that profile has never had a Bot Chat, Herts creates the empty named chat. An unavailable or ambiguous existing chat produces an error. Herts does not create a replacement.

**New bot → Create bot** creates a fresh or cloned profile and sends “Hey, tell me about yourself!” once. Creating a bot can use model tokens. The introduction uses the normal conversation send receipts. If the profile needs provider authentication, the introduction fails. The bot remains available, and the chat explains the failure. Configure missing provider authentication in Hermes. Clones include config, skills, persona and memory, without history or messaging-channel credentials. The credential-copy checkbox controls copying the main profile’s provider credentials through Hermes.

**Edit bot** changes its display title, description, model/provider and persona. The profile identifier stays fixed. These are profile settings; Hermes controls when an existing session adopts changed configuration. Saving does not start a turn. If another device changed the profile, select **Reload saved values → Replace draft** in the editor. Review the current settings before you save again. Skills, toolsets, MCP servers and avatars can still be managed in Desktop. Existing image avatars are displayed; other bots receive initials.

**Hide** removes a bot from the usual roster using shared profile metadata. **Show hidden bots** makes it reachable again. Hiding does not stop the bot or its routines. Permanent profile deletion is not offered.

## Routines

Choose **Routines** beside **Edit bot** in the chat header. Create and edit instructions, schedules and result delivery; pause/resume, delete or run an existing routine. Schedule times use the configured Hermes timezone. If that setting is absent, they use the server timezone. Next and last run timestamps use your device’s timezone.

New routines deliver to Bot Chat by default; choose **Save only** to retain results in Hermes without chat delivery. Editing an existing routine preserves fields outside the form, including other delivery destinations. **Results** lists recent runs and lets you read their messages. Script-only runs have the preview exposed by Hermes instead of an agent transcript.

Hermes’ trigger endpoint resumes paused routines, so their button is labelled **Resume & run now**. Routine actions are online-only and are not queued for later execution. Herts does not run a scheduler.

## Offline use and recovery

Saved roster data, cached chat history and drafts remain available offline. Remote actions require a connection. Forms retain drafts on their original device.

**Recent actions** opens a separate history dialog with bot names, operation status and links to inspect affected bots or routines. Successful chat openings are omitted. It shows durable status. A lost acknowledgement or restart can leave an action **unknown**. Refresh the roster, chat, or routine to inspect Hermes before you take another action. Herts never automatically repeats an uncertain profile creation, introduction or routine run. The action records survive plugin reset. Empty-chat creation can remain unconfirmed when Herts cannot find the canonical chat. In this case, open the bot in Hermes Desktop to resolve its state. Then refresh Herts. Navigation does not repeat chat creation.

With Bots enabled, permanent chats appear in **Conversations → Show all**. Disabling Bots leaves retained chats available in Conversations, along with their drafts, settings and accepted work. Reset removes Herts’ plugin records and local plugin drafts, not Hermes profiles, chat history or routines. Hermes routines continue when Herts closes or Bots is disabled.

## Compatibility and boundaries

Bots requires profile-aware Hermes Desktop APIs, exact hidden-session lookup, materialised session titles, profile metadata revisions and profile-stamped cron endpoints. An unsupported operation reports an error; Herts never silently directs it to the default profile.

The installation still uses one backend. Existing Conversations keep the configured default profile. Bot conversations use their own profile for history, sends, settings, attachments, transcription, and speech. Backend credentials stay on the Herts server.

This release does not add slash commands: `/new`, `/reset` and `/compact` remain ordinary message text in Herts. Group chats, multiple backends, profile deletion, and profile identifier changes are unavailable. Capability editors, avatar editing, roster sections, and mention autocomplete are also unavailable.

## Interface and drafts

The whole bot row opens its chat. Swipe right to Edit bot, or left to Hide/Unhide; a hide notice offers Undo. Keyboard users can open Edit bot from the chat header or focus the row’s hide action. Hide/Unhide is also available in the bot’s page details. Search and Show hidden bots are remembered while navigating the app. “Updated” means activity since this bot was last viewed on this device, rather than a synchronised unread count.

Bot and routine forms save local drafts with an explicit status. Saved drafts are listed on their bot or routine list, and each new draft has its own slot. Discard draft asks before deleting local changes. New drafts can be written offline. An existing bot’s settings must have been opened once online to edit them offline. Fields stay locked through the remote save and local draft acknowledgement. If acknowledgement fails after Hermes saves successfully, select **Finish saved change**. This action only clears the local draft. It cannot submit a second create. Reload saved values asks before replacing unsaved edits.

Bot settings apply to the shared Hermes profile. Conversation settings beside the composer apply on that chat’s next Send and may override profile defaults. Creating a bot still sends its introduction once.

Routines display readable schedule summaries. Existing daily, weekly and interval schedules open in the corresponding editor; complex or explicitly zoned schedules retain their original expression. Results have individual URLs, full-row navigation, browser Back support and saved reading positions. They share conversation Markdown, timestamps, read-aloud controls and Reading link actions. All loaded result pages remain available offline.

Routine edits include the version opened in the editor. A changed routine must be reviewed before saving: **Use current values** replaces the draft, while **Keep my reviewed draft** explicitly accepts replacing the reviewed settings. Herts applies its own updates in sequence and sends only changed fields. The current Hermes cron API has no atomic compare-and-swap. Desktop can change the routine between the Herts check and write.

Unconfirmed saves remain locked when their editor is reopened. **Check save status** retrieves the original operation; **Review current values** shows Hermes state. A further attempt requires an explicit review and acknowledgement. Recent actions filters by bot before pagination and keeps unresolved actions visible. It labels Hide/Unhide separately and links directly to the affected routine. **Mark reviewed** records a human review without claiming an uncertain action succeeded.

## UI regression coverage

`tests/browser/ui-consistency.spec.ts` covers the roster, routines, run lists, result pages, bot editors, and routine editors. It also covers short Bot Chat layouts. Checks use 320, 390, 768, and 1280 pixels in every built-in theme. Populated fields, long result links/output, focused textareas, dialog bounds and an emulated visual viewport are checked. Review its screenshots alongside Conversations and Settings; geometry assertions alone do not establish visual consistency.

`tests/browser/bots-ui.spec.ts` combines navigation with delayed saves, failed reads, local cleanup failure, and stale edits. It also covers old-version drafts, offline result pagination, and unconfirmed operations. The assertions check preserved values and remote effect counts, as well as visible controls. `tests/bots.test.ts` checks routine conflict handling, changed-field writes, scoped/paginated action history and verified result audio against an isolated backend.

Release validation uses synthetic profiles and messages. The browser suite uses Chromium; a simulated visual viewport does not replace a physical-device Safari keyboard check. The Quality workflow must be configured as a required repository status check before it can enforce a merge gate.
