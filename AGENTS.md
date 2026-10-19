# Working on Herts

## Documentation rule

Use **ASD-STE100 Simplified Technical English (Issue 9)** for all project documentation.
Apply this rule on every task, without a user reminder.
Before you write documentation, read [the project writing guide](docs/documentation-style.md).
Use its technical terms and review steps.

This rule covers README files, guides, contributor instructions, release notes, API descriptions, and new or changed code comments.
It also covers documentation in pull requests and generated documentation templates.
Keep code, commands, identifiers, exact UI labels, quotations, and legal text unchanged when accuracy requires their original form.

Use direct instructions, active voice, and consistent terms.
The project limits all prose sentences to 20 words, including descriptions.
Run `npm run check:docs` after documentation changes.
Correct failures before you finish the task.
Review meaning and approved vocabulary separately; the automatic check does not verify full STE compliance.
Do not disable checks or add exceptions only to make a check pass.

## Design authority

Read [DESIGN.md](DESIGN.md) before changing the interface.
It defines the intended design and generates application tokens.
Design rule changes require explicit user approval.
Do not change the specification merely to accept an implementation difference.
Run `npm run design:generate` after approved token changes.
Run `npm run check:design` before completing interface changes.

## UI text

Keep UI text short.
Use labels and current values instead of explanatory paragraphs.
Add help only when users need it to make a decision or recover from an error.
Show warnings on the affected screen with a specific recovery action.
Do not repeat status information or describe internal storage and synchronization rules in normal dialogs.
Review new UI text for unnecessary explanations before completion.

## UI completion criteria

Before you implement a screen, inspect the closest existing Herts screen.
Inspect the shared components in `src/ui.tsx`, `src/ui.css`, and `sdk/client.ts`.
Reuse the app's search, list, form, dialog, message, draft, and conversation patterns.
Add missing components to the shared layer instead of copying similar components into a plugin.

A successful normal workflow is insufficient to complete a UI change.
For each new or substantially changed screen, complete these checks:

- Add the screen to `tests/browser/ui-consistency.spec.ts`. Check layouts at 320, 390, 768, and 1280 pixels. Check Press, the only available theme. Include a short viewport for conversation layouts with fixed heights.
- Use realistic long titles, URLs, descriptions, and output. Check field and page bounds, full navigation targets, keyboard focus, and dialog dismissal. Compare actual screenshots with the closest existing screen. Bounds checks alone are insufficient.
- Check loading, empty, filtered-empty, offline, cached, failure, and retry states. Keep existing drafts available offline. Distinguish a server connection failure from a missing record.
- Delay reads and mutations. Protect edits through submission and draft acknowledgement. Ignore obsolete responses. Never automatically repeat remote actions with unknown effects.
- Add behavioural regression tests for data preservation and recovery. Use isolated synthetic data. Never use live bots or model prompts for validation.
- State the checks completed and any remaining limits. Workflow test counts do not prove visual consistency.

## Test scope

Select checks from the changed behavior and its dependencies before you start tests.
Use the [test selection policy](docs/testing.md#test-selection-policy).

For small text, layout, or plugin changes, build the affected package and run checks for the affected workflows.
Run type checks when TypeScript changes.
For UI changes, inspect screenshots and check the affected controls at narrow and wide widths.
Check additional themes when the change affects theme styles or shared layout rules.
Test draft preservation and recovery when the change affects editable controls.
Use existing tests when they cover the change.
Do not add tests that only repeat the implementation.

Small updates may be deployed after these checks pass.
A small update does not require the full release suite or the complete theme and viewport matrix.
The full screen criteria above still apply to new screens and substantial screen changes.
Use `npm run test:ui -- --grep '<affected tests>'` to select relevant UI tests.

Run `npm run check:release` for changes to storage, migrations, authentication, remote actions, dependencies, or plugin runtime behavior.
Also run it for shared changes that affect multiple workflows and for grouped or scheduled releases.
Do not repeat successful checks unless code changes or new evidence requires them.
If an unrelated test fails, investigate it separately and report the result.
An affected test failure must be resolved before deployment.
State completed checks, omitted checks, and remaining limits.
The Quality workflow runs release checks on pull requests.
Configure it as a required status check in repository branch protection to prevent merges when checks fail.

## Updating the running installation

Build and test before you replace the served browser bundle.
The browser fixture accepts `HERTS_TEST_DIST_DIR` for a staged Vite build.
Keep previous hashed assets for existing clients.

Browser App updates, server restart, and plugin-package Update are separate steps.
Apply all steps that the change requires.
Verify the running service and plugin, as well as files on disk.
Keep a private backup before server or data upgrades.
Restart only the Herts app service when necessary.
Existing installations can use `hermes-tasks.service` instead of `herts.service`.
Never restart the Hermes backend only to load Herts changes.
