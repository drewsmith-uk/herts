# Design implementation checklist

[DESIGN.md](../DESIGN.md) defines the intended design approved through the design discussion.
This checklist records implementation work; unchecked items are not complete.
Application changes and token generation are implemented.
Release validation and installation updates are tracked below.

## Validation record

The pinned validator is `@google/design.md` version `0.4.0`.
Run `npm run check:design` to validate the format, references, contrast, and generated files.
Run `npm run design:generate` after approved token changes.
The generator produces Press theme values and shared CSS variables from DESIGN.md.

The validator reports four unused-component warnings for drag and border colours.
The generator uses these colours through semantic CSS variables.
The standard component schema has no border properties.
No warning is suppressed.
All 20 required contrast pairs pass full-precision comparisons.

The current unit and integration run passed 389 tests.
The installer checks passed eight tests.
All 347 browser tests passed across 56 isolated spec files.
The release command stopped at a drag-preview height failure.
After correction, the affected layouts passed, and all remaining release suites completed.
Final surface checks cover collapsed capture fields and recessed select fields.
Technical meaning and terminology received manual review, not a complete dictionary audit or STE certification.

## 1. Validate and generate tokens

- [x] Select and pin a compatible Google DESIGN.md validator.
- [x] Validate the document schema and all token references.
- [x] Add a deterministic generator from DESIGN.md to application tokens.
- [x] Map every existing theme property to its intended semantic source.
- [x] Review unmapped states, including hover, success, warning, disabled, and focus states.
- [x] Map remaining states to approved palette colours without adding new colours.
- [x] Keep borders, shadows, and layout rules consistent with the document.
- [x] Add generation checks that fail when committed output is stale.
- [x] Test invalid references, invalid dimensions, stale output, and failed contrast pairs.
- [x] Calculate contrast from tokens using full precision for threshold comparisons.
- [x] Integrate validation into normal build and release checks.
- [x] Document the pinned format version, generator command, and validation command.

## 2. Restrict appearance to Press

- [x] Remove the theme selector and its unused settings layout.
- [x] Resolve old selections to Press before first paint.
- [x] Preserve semantic CSS variables and shared theme infrastructure.
- [x] Retain inactive theme definitions without exposing selection controls.
- [x] Remove Press dependencies on inactive theme defaults where generation makes them unnecessary.
- [x] Check startup, storage failures, multiple tabs, cached clients, and offline reloads.
- [x] Update appearance tests to verify Press-only behaviour.

## 3. Bundle Inter

- [x] Bundle the approved font files and licence attribution.
- [x] Cache the files for offline use through the normal asset pipeline.
- [x] Apply Inter to headings, controls, and body text through shared tokens.
- [x] Preserve monospace code and necessary path styling.
- [x] Keep 16px input and title text, with 14px control labels.
- [x] Check font loading, fallback rendering, text zoom, and long content.
- [x] Preserve wrapping task titles and content-driven card heights.

## 4. Align shared components

- [x] Apply the approved palette, 1.5px standard borders, and hard shadows.
- [x] Retain stronger selection borders and independent focus indicators.
- [x] Keep primary controls and editable fields at least 44px high.
- [x] Review existing compact secondary controls individually.
- [x] Use recessed short fields and white long-text editors.
- [x] Prevent focus border changes from moving content.
- [x] Apply one blue primary action per page or dialog.
- [x] Keep destructive actions separate and completion indicators neutral.
- [x] Preserve SVG icons and user-authored emoji.
- [x] Preserve persistent pointer and keyboard reordering through shared operations.
- [x] Verify focus restoration, dialog dismissal, and native radio focus indicators.
- [x] Retain connection details, warning distinctions, and explicit recovery actions.

## 5. Change space deletion protection

- [x] Audit original-space assumptions in browser code, server code, storage, and migrations.
- [x] Protect the current default space from deletion.
- [x] Permit deletion of an eligible original space after another space becomes default.
- [x] Require at least one valid default space throughout each operation.
- [x] Replace original-space fallback assumptions with validated default-space references.
- [x] Preserve task, draft, recording, and concurrent-change safeguards.
- [x] Recheck the default and space contents atomically on the server before deletion.
- [x] Reject stale offline deletion requests when the target has become default.
- [x] Test deleting a former default and an eligible original space.
- [x] Test concurrent default changes, failed requests, pending edits, and older clients.
- [x] Test migration and recovery with isolated existing-installation fixtures.

## 6. Reconcile existing guidance

- [x] Add design authority instructions to AGENTS.md when adopting the specification.
- [x] Replace outdated Edit list guidance in decisions.md.
- [x] Replace original-space deletion rules with current-default protection rules.
- [x] Update theme documentation for Press-only availability and retained infrastructure.
- [x] Record that Inter was explicitly approved in the design discussion.
- [x] Update README descriptions that mention theme selection.
- [x] Update plugin scaffolding instructions to reference DESIGN.md and shared components.
- [x] Preserve unaffected behaviour and operational guidance.

## 7. Verify and release

Use the [test selection policy](testing.md#test-selection-policy).
This grouped implementation affects shared UI, dependencies, and space storage assumptions.
It requires `npm run check:release` before deployment.

- [x] Run schema, generation, contrast, documentation, and relevant behavioural checks.
- [x] Check Press at 320px, 390px, 768px, and 1280px.
- [x] Check short conversation viewports and on-screen keyboard layouts.
- [x] Inspect screenshots against the closest existing screens.
- [x] Cover loading, empty, filtered-empty, offline, cached, failure, and retry states.
- [x] Test delayed reads, delayed mutations, draft acknowledgement, and unknown outcomes.
- [x] Use synthetic data without live bots or model prompts.
- [x] Complete the release checks and report any unrelated failures separately.
- [x] Back up the installation before server or data changes.
- [x] Build into a staged directory before replacing served assets.
- [x] Retain previous hashed assets for existing clients.
- [x] Apply browser, plugin-package, and app-service updates as required.
- [x] Verify the running installation and plugin versions.
- [x] Record completed checks, omitted checks, remaining differences, and recovery instructions.

Do not restart the Hermes backend to load Herts changes.
Follow the [installation update rules](../AGENTS.md#updating-the-running-installation).

## Verification limits

Chromium checks used synthetic data, including existing-installation migration fixtures.
Screenshots covered phone, tablet, desktop, short viewports, and simulated keyboard layouts.
Additional checks covered blocked font downloads, 1x and 2x display scales, and 200% CSS zoom.
Physical devices, native text-size settings, and other browser engines were not tested.
The automatic format validator retains four documented warnings.

## Installation record

The running browser build is `90bdd75bbb86`.
The tested output is in `.runtime/weight-review`.
Tasks version `1.0.3` is enabled.
The running theme catalogue contains only Press.
Served HTML, CSS, service worker, and Inter bytes match the tested output.
Previous hashed browser assets remain unchanged.
Authenticated Herts access and read-only Hermes connection checks passed.
Only `hermes-tasks.service` restarted.
No live model work was started.

Private backups are in `backups/design-2026-10-19` and `backups/design-2026-10-19-deployment`.
The first backup includes the previous browser bundle and source archive.
The second backup was taken with the app service stopped.
For recovery, follow [Backups and upgrades](maintenance.md).
Do not restore older data without reviewing changes made after the backup.
Existing tabs can apply the new browser version through Settings → App updates.

## Typography adjustment

The approved adjustment keeps Inter and the existing heading weights.
Card titles, tabs, and ordinary controls use weight 500.
Primary buttons use weight 600.
Body text remains at weight 400.
DESIGN.md defines these weights, and the generator produces their CSS variables.

The staged build, documentation checks, design validation, and five generator tests passed.
Three existing layout tests covered affected screens at phone, tablet, and desktop widths.
Two browser inspection checks confirmed rendered weights at 390px and 1280px.
The corresponding screenshots received visual review.
The full release suite was not repeated for this small typography correction.
No storage, server, or plugin runtime behaviour changed.

The browser update required no service restart or plugin update.
Served assets match the tested build, and previous assets remain available.
The previous browser bundle is in `backups/design-weights-2026-10-19/browser-dist`.
