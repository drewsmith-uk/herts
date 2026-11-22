# Calls stage-one feasibility report

## Boundary

This stage implements a call prototype with simulated validation.
It does not change Hermes source or configuration.
It does not introduce a standalone OpenAI mode or another Herts API key.
Telephone integration and canvas rendering remain excluded.
The call controller is independent of the conversation screen, allowing a later canvas.

The user confirmed that GPT-Live works in Hermes Desktop.
A prior read-only Herts check confirmed GPT-Live configuration and credential resolution for the default profile.
Those observations do not establish actual Pixel call behaviour.

## Main-source correction on 3 November 2026

The first Calls release used older release source instead of current `main`.
It omitted the merged Reading cleanup controls and their composer support.
Its tests also used older Reading and Tasks packages.

The corrected release uses `main` commit `fcd4d39`, with Calls and the plugin-refresh correction.
The source tree was verified against the current GitHub `main` branch.
The release directory is `.runtime/releases/calls-main-fcd4d39`.
The browser build is `tasks-shell-9be4e16c5c6f`.
Node 24.22.1 and the dependency lock remain unchanged.

Reading 1.0.3 restores URL cleanup, its editable preview, and saved defaults.
Tasks 1.0.4 and the current Pinned package restore the other merged changes.
Calls remains enabled.
Installed package hashes and served clients match the tested build.
Reading preferences, saved items, and conversation references were retained.
Hermes was not changed or restarted.

All 568 unit and API checks passed across the initial run and the focused rerun.
All 11 installer checks and 63 browser specs passed.
One migration check exceeded the existing timeout during concurrent validation.
It passed separately with the same timeout and unchanged code.
Browser group 2 recorded all 21 specs passed and printed completion.
Its command wrapper later returned exit code 143.
The complete test reports remain available.

Reading cleanup passed all nine workflow checks.
Calls passed all ten workflow checks.
All 66 interface checks passed.
Reading screenshots were inspected at 320, 390, 768, and 1280 pixels.
Calls and Pinned screenshots were also inspected.
These checks used synthetic services and data.
Actual Pixel audio checks remain outside this correction.

Deployment evidence and the private backup are in `.runtime/calls-main-repair`.
The release includes `release.json` with source and package identities.

Apply the browser update through **Settings → Connection and updates → App updates**.
Select **Check for updates**, then **Update now**.
Reading should show **Remove query string** and its editable preview again.

## Initial automated evidence

| Area | Evidence |
| --- | --- |
| Hermes adapter | Synthetic checks cover profile selection, exact SDP, response filtering, and failed or unknown setup. |
| Delegation | Synthetic checks cover duplicate events, sequential requests, spoken context, and submission recovery. |
| Lifecycle | Synthetic checks cover capture cleanup, startup deadlines, closure deadlines, late events, and browser suspension. |
| Data | Browser checks preserve typed drafts, transcripts, and unconfirmed call records through reload. |
| Notifications | Checks cover owning-window routing, delayed acknowledgement, dismissal, stale records, and confirmed-close removal. |
| Interface | Screenshots cover Press at 320, 390, 768, and 1280 pixels, including a short viewport. |
| Calls controller | All 17 focused tests passed. |
| Calls browser | All ten Chromium workflow tests passed with the final plugin package. |
| Final layouts | All five Calls viewport checks passed. Narrow, wide, and short-screen screenshots were inspected. |
| Other browsers | Five earlier Firefox layout checks passed. WebKit could not launch because required system libraries were unavailable. |
| Release preparation | Design, types, builds, 546 unit and API tests, and 11 installer tests passed. |
| Release browser checks | All 62 specs passed across the release run and corrected plugin-removal run. |
| Focused browser checks | All 35 checks passed across five affected specs after the correction. |
| Plugin refresh | API and browser checks cover plugin removal and microphone cleanup after another window disables Calls. |

The validation date was 2 November 2026.
Deployment preparation uses Node 24.22.1 and the running release's unchanged dependency lock.
Dependencies were installed with `npm ci`.
The earlier workspace validation used older dependencies.
Its results do not replace deployment validation.

The release browser checks found a stale plugin catalogue during folder removal.
Conversation refresh now includes standard plugin routes and reports disabled plugins.
The corrected plugin-removal suite passed.
All 50 affected unit and API checks passed across two runs.
One unrelated API check required the release runner's existing 15-second timeout.
It had failed with the shorter default timeout.

The tested release is `.runtime/releases/calls-20261102-stage1`.
Its browser build is `.runtime/release-dist` within that directory.
The prepared package is `.runtime/calls-deploy/calls-0.1.0.tar.gz`.
Validation logs remain in `.runtime/calls-deploy`.

All automated media and model events are synthetic.
Browser fixtures block external requests and use isolated local services.
No live call was started during validation.
Automated screenshots cannot prove Android suspension, notification, or audio behaviour.

## Initial installation

Calls was deployed and enabled on 2 November 2026.
The browser build is `tasks-shell-3777ca60adef`.
The release retains Node 24.22.1 and the previous dependency lock.
A private backup was completed before the app service restarted.
Previous hashed browser assets remain available for open clients.
Existing plugin versions and saved conversation references were retained.

The authenticated access and read-only Hermes connection checks passed.
The default profile reports GPT-Live available, with model `gpt-live-1` and voice `marin`.
Hermes source and configuration were not changed.
The Hermes process was not restarted.
No live call was started.

On the Pixel, open **Settings → Connection and updates → App updates**.
Select **Check for updates**, then **Update now** when available.
Open an existing conversation and select **Actions → Call → Start call**.
Keep Herts open for the first call.
Use the device checklist below for subsequent checks.

## Pixel observations and usability changes on 5 November 2026

The primary device is a Pixel 9 Pro XL with Android 17 and Chrome 156.0.8078.79.
The user confirmed call startup, navigation, notification permission, and Bluetooth audio.
Backgrounding stopped the call and microphone.
A connection-loss screenshot showed **Closure unconfirmed** with the microphone apparently off.
This observation does not establish remote closure.

The usability changes add a shared call bar, grouped transcripts, and separate Calls settings.
Connection sounds and one requested GPT-Live greeting make startup more apparent.
The background reason remains separate from closure confirmation.
No Hermes source changes or additional credentials are required.
Canvas rendering remains deferred.

The new device checks cover greeting playback, interruption, connection sounds, and background recovery wording.
Automated checks cannot establish actual audio quality or Android suspension behaviour.

## Usability release validation and deployment

Calls 0.1.1 was deployed on 5 November 2026.
The browser build is `tasks-shell-8519a7ea502e`.
The release uses current `main` commit `fcd4d39` and the unchanged Node 24.22.1 dependency lock.

All 575 unit and API checks and 11 installer checks passed.
All 63 browser specs completed successfully across initial runs and isolated rechecks.
Calls passed 19 workflow checks.
All 66 interface checks passed.
Five additional Calls checks cover final bar wrapping, long configuration values, and recovery screens.
Screenshots were inspected at 320, 390, 768, and 1280 pixels, including a short viewport.
Validation used Chromium with synthetic media and services.
No live call or model request was started.

Two unrelated checks failed initially.
The first failed during fixture teardown after its assertions passed.
The second exceeded the conversation Stop assertion timeout.
Both passed unchanged in isolation.
The initial reports and traces remain available.
Browser group 1 recorded all 21 specs passed and printed completion.
Its command wrapper returned exit code 143.

A private backup was completed before deployment.
Installed package hashes and served clients match the tested packages.
Previous browser assets remain available for existing clients.
Reading preferences, saved items, plugin settings, and conversations were retained.
Hermes was not changed or restarted.
Authenticated access and read-only Hermes connection checks passed.
The default profile reports GPT-Live available, with model `gpt-live-1` and voice `marin`.

Evidence and the private backup are in `.runtime/calls-usability`.
Apply the browser update through **Settings → Connection and updates → App updates**.
The next Pixel check covers the connection sound and initial greeting.
Actual greeting playback, interruption, and Android suspension still require device checks.

## Page actions correction on 5 November 2026

Calls 0.1.2 restores the normal conversation Page actions menu in call mode.
The original Calls screen omitted the conversation context from its header.
It also inserted a large title inside the menu.
Call mode now uses the shared conversation screen, including its existing actions and title editor.
Call controls remain above the history, and Transcript remains in the toolbar.

The regression check reproduced the missing actions on the previous build.
All 35 focused browser checks passed with the correction.
These include 21 Calls checks, five layout checks, six title-editing checks, and three conversation-header checks.
Checks cover active calls, Hide and Unhide, Make a task, dialog dismissal, and message-draft preservation.
Existing title checks cover offline edits, delayed saves, and conflicting acknowledgements.
Screenshots were inspected at 320, 390, 768, and 1280 pixels, including a short viewport.
Type checks, package builds, the browser build, and design checks passed.
The full release suite was omitted for this small UI composition correction under the test selection policy.
Validation used synthetic services and media.
Evidence is in `.runtime/calls-actions`.
The deployed browser build is `tasks-shell-708613bf4727`.
Served browser and plugin files match the tested packages.
Saved conversations, Reading preferences, and plugin settings were retained.
Hermes was not changed or restarted.

## Call layout correction on 5 November 2026

Calls `0.1.3` uses one control row below the conversation header for every call state.
Ready, connecting, active, closing, and ended calls keep the same position and height.
**Call again** replaces the separate restart block.
Background endings show their reason inside the control row.
Unconfirmed closure retains its recovery message and a **Review conversation** action.
Other screens retain the active call controls and **Return to call**.
The change preserves the shared conversation, page actions, and drafts.

Twenty-seven browser checks passed across call workflows and five viewport cases.
Screenshots were inspected at 320, 390, 768, and 1280 pixels, including a 480-pixel height.
Checks cover every call state, page actions, transcript access, offline drafts, loading, failures, and retry.
Short screens keep expanded message controls above navigation when recovery messages appear.
The affected recovery and short-screen cases passed again after that correction.
Type checks, builds, documentation checks, and design checks passed.
The full release suite was omitted under the small UI correction policy.
The changes affect Calls presentation only.
Validation used synthetic services and media.
Physical Pixel confirmation remains outstanding.
The browser bundle and other prepared plugin packages are unchanged.
Evidence is in `.runtime/calls-layout`.
Calls `0.1.3` is installed and enabled.
The served client matches the tested package.
The browser build remains `tasks-shell-708613bf4727`.
Herts and Hermes were not restarted.
Plugin settings, saved conversations, Reading preferences, and Reading items were retained.
The current release record identifies the separate Calls source in `pluginRelease`.

## Remaining limits

The user confirmed working calls and Bluetooth audio on the primary Pixel.
Greeting playback and connection sounds require new device checks.
The shared conversation still exposes dictation and message playback.
Do not use those audio controls during a prototype call.
Simultaneous use remains outside this stage's validation.
Chrome can terminate a page without running its cleanup callbacks.
The existing Hermes adapter provides no independent remote hangup endpoint for this prototype.
Without `session.closed`, Herts must retain an unconfirmed closure outcome.
A notification cannot prove closure or independently close a lost transport.

Requests without available speech transcripts remain unsent.
Each delegation submits new speech and retains earlier speech as context.
New speech requests wait while Hermes performs earlier work.
Unknown submissions stop automatic dispatch until their outcome is resolved.
Call startup has a 45-second deadline.
Graceful closure has a 15-second deadline.
Microphone capture and playback stop before waiting for closure.

## User device checklist

The user performs these checks after installation.
They are outside automated validation and do not change the repository testing rule.

1. Record the Pixel model, Android version, and Chrome version.
2. Open Herts from its installed app icon.
3. Start a call from an existing conversation.
4. Check microphone permission, audible replies, interruption, and mute.
5. Confirm that spoken requests and Hermes results appear in the linked conversation.
6. Confirm that approvals require the existing screen controls.
7. Navigate within Herts and use **Return to call**.
8. Enable the optional call notification and return through it.
9. Press Home, switch apps, and lock the screen in separate attempts.
10. Confirm that returning never automatically enables the microphone.
11. End a call and check the microphone indicator and notification.
12. Repeat with a Bluetooth headset.
13. Interrupt connectivity and check the displayed recovery state.
14. Confirm that accepted Hermes work remains accessible after hangup.

## Device report template

| Field | Result |
| --- | --- |
| Pixel model | |
| Android version | |
| Chrome version | |
| Herts build and Calls version | |
| Speaker or headset | |
| Network connection | |
| Steps performed | |
| Expected behaviour | |
| Observed behaviour | |
| Call status after returning | |
| Microphone indicator after hangup | |
| Notification after hangup | |
| Approximate startup and reply delays | |

Exclude credentials and private conversation content from shared reports.
