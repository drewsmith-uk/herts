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

## UI completion criteria

Before you implement a screen, inspect the closest existing Herts screen.
Inspect the shared components in `src/ui.tsx`, `src/ui.css`, and `sdk/client.ts`.
Reuse the app's search, list, form, dialog, message, draft, and conversation patterns.
Add missing components to the shared layer instead of copying similar components into a plugin.

A successful normal workflow is insufficient to complete a UI change.
For each new or substantially changed screen, complete these checks:

- Add the screen to `tests/browser/ui-consistency.spec.ts`. Check layouts at 320, 390, 768, and 1280 pixels. Check every built-in theme. Include a short viewport for conversation layouts with fixed heights.
- Use realistic long titles, URLs, descriptions, and output. Check field and page bounds, full navigation targets, keyboard focus, and dialog dismissal. Compare actual screenshots with the closest existing screen. Bounds checks alone are insufficient.
- Check loading, empty, filtered-empty, offline, cached, failure, and retry states. Keep existing drafts available offline. Distinguish a server connection failure from a missing record.
- Delay reads and mutations. Protect edits through submission and draft acknowledgement. Ignore obsolete responses. Never automatically repeat remote actions with unknown effects.
- Add behavioural regression tests for data preservation and recovery. Use isolated synthetic data. Never use live bots or model prompts for validation.
- State the checks completed and any remaining limits. Workflow test counts do not prove visual consistency.

Run `npm run test:ui` for affected UI.
Run `npm run check:release` before you finish a release.
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
