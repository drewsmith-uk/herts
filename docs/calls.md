# Calls prototype

Calls connects a Herts conversation to GPT-Live through Hermes.
Hermes creates the voice session and keeps its OpenAI credentials.
The browser carries audio through WebRTC.
Hermes performs delegated work in the linked conversation.

This prototype targets an installed Chrome app on Google Pixel.
Automated checks use synthetic services and media only.
Actual device behaviour remains subject to user testing.

## Installation

The prototype requires its matching Herts server and browser build.
The Calls package starts disabled.
No Hermes source changes are required.
Use the existing GPT-Live configuration in the selected Hermes profile.

1. Follow the [backup and upgrade procedure](maintenance.md).
2. Install the tested Herts server changes and staged browser build.
3. Preserve previous hashed browser assets for existing clients.
4. Restart only the Herts app service when installing server changes.
5. Copy the prepared `calls` folder into the configured plugin directory.
6. Open **Settings → Plugins** and rescan the directory.
7. Enable **Calls**. For an existing package, select **Apply update**.
8. Apply the browser update through **Settings → App updates**.

The prepared folder contains `plugin.json`, `client.js`, `server.mjs`, and `THIRD_PARTY_NOTICES.txt`.
Server installation, browser updates, and plugin updates are separate operations.
Building or testing this prototype does not deploy or enable it.

## Use

1. Open an existing Hermes conversation.
2. Open **Actions** and select **Call**.
3. Select **Start call**.
4. Allow microphone access when Chrome requests it.
5. Use **Mute** to stop sending microphone audio temporarily.
6. Use **End call** to close the voice session.

Call controls stay below the conversation header in every state.
Select **Call again** after a call ends.
The screen retains the shared conversation panel and existing message draft.
During prototype calls, avoid dictation and message playback in the conversation.
Use its approval and clarification controls when Hermes needs input.
Spoken approval does not activate those controls.
Stopping speech does not cancel Hermes work.
Ending the call does not cancel accepted Hermes work.

Navigation within visible Herts preserves the call and its original conversation.
Use **Return to call** to return to that screen.
Only one Herts call can run in the browser installation.

## Connection and transcript

A quiet connection sound plays while the call starts.
The sound stops when the session is ready or setup ends.
Disable **Connection sounds** in **Settings → Plugins → Calls** to start calls silently.
The preference does not change conversation audio or the greeting.
Browser audio restrictions can prevent the connection sound.

Herts requests one brief GPT-Live greeting when the session becomes ready.
The initial developer message contains greeting instructions through the existing Hermes history input.
A single commentary event requests the greeting without creating a Hermes task.
GPT-Live can change the wording or remain silent.
Navigation and duplicate readiness events do not repeat the greeting.

Select **Transcript** to read grouped speech turns.
New text follows the current view only when you are already at the bottom.
Earlier reading positions remain unchanged.
Unsent requests appear only when present.
Voice, model, and profile values appear in Calls settings.
Configure these values in Hermes.

## Background and recovery

Hiding Herts stops microphone capture and playback.
Herts requests closure while the connection remains available.
Browser suspension can prevent confirmation.
Herts stores the background reason separately from the closure result.
**Closure unconfirmed** means Herts did not receive a final closure event.
It does not prove that the remote session remains active.
Returning to Herts never automatically starts the microphone or repeats submitted work.

Select **Review conversation** before starting another call after an unknown outcome.
Accepted work remains visible in the conversation.
Queued requests stop when the call ends.
Open **Transcript** to copy an unsent request for an explicit message submission.
Unknown submissions must be reviewed through the shared conversation controls.

Text transcripts and call recovery records remain in plugin-local browser storage.
Herts records no raw call audio.
Resetting Calls removes its local records through the existing plugin reset workflow.
Hermes conversation messages and action receipts remain independent of plugin reset.

## Notifications

Open **Settings → Plugins → Calls** and enable **Call notifications** to request notification permission.
Calls remain available when notification permission is denied.
An active call shows **Call in progress**.
Unconfirmed closure shows **Check call status**.
Confirmed closure removes the notification.
Tapping returns to the owning window when that window remains available.
The notification does not start a call or enable the microphone.
Dismissed call notifications are not automatically restored.
Suspension can leave a notification stale until Herts runs again.

## Host interfaces

`HermesServices.voiceLive` provides `status(contextId?)` and `create({ contextId, sdp }, effects)`.
Creation uses the Hermes profile from the linked conversation.
Status without a conversation uses the configured default profile.
Creation uses durable remote-action receipts and never enters the offline command queue.
The response contains only the session identifier and WebRTC transport answer.
SDP negotiation text retains its original line endings.

Send actions accept optional `voice` metadata with `callId`, `delegationId`, and `context` fields.
The host sends the existing Hermes `voice-live` surface marker and spoken context.
Ordinary text submissions retain their existing behaviour.
Duplicate delegation identities cannot create another submission.

`voiceLiveClientVersion` identifies compatible browser support.
The optional `ClientPlugin.GlobalStatus` component provides shared controls across screens.
Device notifications accept optional `ownerWindow` and `inactiveTitle` fields.
The service worker derives the owner identifier from the sending window.
Existing notification behaviour remains the default when these fields are absent.

## Development checks

Use the repository's Node.js version and installed dependency requirements.
Build the package with this command:

```sh
npm run build:plugin -- plugins/calls
```

Run the required release checks without replacing the served browser build:

```sh
npm run check:release
```

The release runner writes browser assets to `.runtime/release-dist`.
See the [feasibility report](calls-feasibility.md) for evidence and the device checklist.

## References

- [GPT-Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [GPT-Live sessions and graceful closure](https://developers.openai.com/api/docs/guides/live-conversations)
- [Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
