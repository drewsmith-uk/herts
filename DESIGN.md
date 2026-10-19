---
version: alpha
name: Herts Press
description: The intended Herts interface, with paper surfaces, clear controls, and explicit recovery actions.
---

# Herts design

## Overview

This document defines the intended Herts design.
Hermes is the external backend, not the application name.
The [implementation checklist](docs/design-implementation.md) records differences that still require work.
This specification does not claim that the running application already conforms.

Use the [Google DESIGN.md format](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) for structured tokens.
A token is a named design value.
Generate application tokens from this document.
Never update this document automatically from application code.
Changes to design rules or token values require explicit user approval.
Changes that follow existing rules do not require a design change.
Correct unintended application differences instead of changing the specification to match them.

Press is the only available theme.
Remove theme selection controls.
Resolve previous theme selections to Press before rendering.
Retain semantic variables, shared components, and inactive theme definitions for possible future use.
Do not expose inactive themes through normal settings.
Support only the current theme API contract.
Do not return legacy theme catalogues or alter theme values for older clients.
Older cached clients must update to use the current appearance.

Use short labels and current values.
Add help only for decisions, errors, or recovery.
Follow the [project writing guide](docs/documentation-style.md).

## Colors

Use semantic tokens in components and plugins.
The palette below defines Press colours.
Transparency and the backdrop alpha are explicit composition rules, not additional opaque palette colours.

```yaml
colors:
  canvas: "#F4F2EC"
  sheet: "#FAF9F5"
  surface: "#FFFFFF"
  lifted: "#FFFDF0"
  input: "#EFECE4"
  subtle: "#E6E3DA"
  ink: "#161511"
  secondary: "#4C4B46"
  muted: "#5A5852"
  grip: "#8A867C"
  border-muted: "#B8B4A8"
  border-subtle: "#C8C4B8"
  divider: "#DCD9CE"
  selected: "#FEE600"
  primary: "#1E3CFF"
  danger: "#992B2B"
```

| Role | Token | Use |
| --- | --- | --- |
| Page | `canvas` | Main background and directory surfaces |
| Sheet | `sheet` | Mobile sheets and compact navigation |
| Writing surface | `surface` | Message composers and long-text editors |
| Card | `surface` | Task and Reading cards |
| Short field | `input` | Search, titles, and folder paths at rest |
| Focused short field | `surface` | Short fields while focused |
| Secondary surface | `subtle` | Inactive filters, counts, and user messages |
| Selection | `selected` | Active navigation and filters |
| Primary action | `primary` | Main submission action, links, and focus indicators |
| Destructive action | `danger` | Destructive labels and icons |
| Drag icon and input boundary | `grip` | Drag handles and short-field borders |
| Disabled boundary | `border-muted` | Disabled button borders |
| Decorative boundary | `border-subtle` | Count badges and inactive filters |
| Decorative divider | `divider` | Directory rows and section separators |

Use one blue primary action per page or dialog.
A dialog has its own action hierarchy.
Destructive actions use destructive styling, not primary styling.
Any exception requires a specific workflow justification and approval.
Use yellow for active navigation and filters.
The connection badge may also use yellow for pending work.
Use neutral completion checkmarks.
Success states use ink on the subtle surface.
Warning states use ink on yellow with an explicit status label.
Destructive messages use danger text on white.
Primary hover states retain blue and use existing interaction feedback.
Underline the active task space instead of adding another yellow selection.

### Contrast requirements

Calculate contrast from tokens with the [WCAG relative luminance formula](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Compare thresholds before rounding displayed results.
Do not claim whole-interface accessibility from a palette check.

| Foreground | Background | Minimum ratio | Purpose |
| --- | --- | --- | --- |
| `ink` | `canvas`, `surface`, `sheet`, `selected` | 7:1 | Main text |
| `secondary` | `canvas`, `surface`, `subtle` | 4.5:1 | Secondary text |
| `muted` | `canvas`, `surface`, `input`, `sheet` | 4.5:1 | Metadata and field hints |
| `surface` | `primary` | 4.5:1 | Primary button text |
| `primary` | `canvas`, `surface`, `input` | 4.5:1 | Links and utilities |
| `danger` | `surface` | 4.5:1 | Destructive button text |
| `grip` | `input`, `canvas`, `surface`, `sheet` | 3:1 | Input boundaries and drag icons |

Decorative dividers do not identify controls by themselves.
Disabled colours apply only to controls that users cannot operate.
Check focus, selection, and error indicators in their actual contexts.

## Typography

Bundle Inter with the application and its licence notice.
Make the font available offline through the app asset cache.
Use system fallback fonts while Inter is unavailable.
Rendering can differ between platforms and user settings.
Do not promise identical text metrics.
Use monospace for code and paths when necessary.

```yaml
typography:
  heading:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  card-title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  control:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  primary-control:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  metadata:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
```

Use weight 500 for card titles, tabs, and ordinary controls.
Use weight 600 for primary buttons.
Selected tabs keep weight 500; colour and borders show selection.
Keep input text at 16px by default.
Support browser zoom and user text settings without losing controls or content.
Task titles wrap, and cards grow to fit them.
Do not replace task titles with single-line ellipses.
Preserve full titles on detail pages when fixed headers use compact titles.

## Layout

Retain current responsive layout boundaries initially.
Use compact navigation at widths up to 1000px.
Use the desktop sidebar above 1000px.
Reading can show Article and Discussion together at widths of 1280px or more.
Preserve drafts and reading positions when layouts change.

Check widths of 320px, 390px, 768px, and 1280px.
Include short conversation viewports and the on-screen keyboard.
Keep navigation, composer actions, and recovery controls reachable.
Account for safe areas and changing viewport heights.

```yaml
spacing:
  tight: "4px"
  item: "8px"
  control-padding: "12px"
  gutter: "16px"
  section: "24px"
  control-target: "44px"
```

Keep the current sizing baseline instead of adopting 32px controls throughout.
Primary controls and editable fields have a minimum height of 44px.
Small visible icons can have larger interaction targets.
Preserve existing justified compact secondary controls until their workflow review.
Do not reduce text size to fit additional content.

Task filters use one horizontally scrolling row.
Keep focused and selected filters visible.
Cards grow with titles, metadata, and text scaling.
Do not promise a fixed number of visible tasks.
Plugin settings use divided sections instead of repeated outer boxes.

## Elevation & Depth

Use hard shadows without blur.
Use 1.5px standard structural borders and 2px borders for stronger selected states.
Use subtle 1px dividers where boundaries are decorative.
Keep focus indicators separate from selection indicators.
Avoid layout movement when focus changes border treatment.

| Element | Border | Shadow |
| --- | --- | --- |
| Resting card | 1.5px ink | None |
| Primary action | 1.5px ink | 2px horizontal and vertical ink offset |
| Short field | 1.5px grip | None |
| Focused short field | 2px primary | 2px horizontal and vertical ink offset |
| Active filter | 1.5px ink | 1px horizontal and vertical ink offset |
| Lifted card | 2px ink | 4px horizontal and vertical ink offset |
| Mobile sheet | 2px ink at top | 4px upward ink offset |

Use the lifted surface for active drag previews.
A lifted preview may move 3px left and upward.
Compose the modal backdrop from ink with 55% opacity.
Sheet rows remain transparent over the sheet surface.
Check thin borders at different display scales.
Respect reduced-motion preferences.

## Shapes

Use square corners for cards, buttons, fields, and sheets.
Use circles for completion indicators, radio indicators, and status badges.

```yaml
rounded:
  none: "0px"
  checkbox: "4px"
  circle: "9999px"
```

## Components

Use [shared components](src/ui.tsx), [shared styles](src/ui.css), and the [plugin client API](sdk/client.ts).
Add missing shared behaviour to that layer.
Do not copy component implementations into this document or individual plugins.
Component token properties describe appearance; they do not prescribe replacement class names.
Apply the minimum control height from Layout instead of setting fixed component heights.
Directory and sheet row tokens specify the effective background for contrast checks.
Rows can inherit that background from their containing surface.

```yaml
components:
  structural-border:
    width: "1.5px"
  action-offset:
    size: "2px"
  primary-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.primary-control}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  secondary-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  destructive-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  short-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  editor:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.card-title}"
    rounded: "{rounded.none}"
  lifted-card:
    backgroundColor: "{colors.lifted}"
    textColor: "{colors.ink}"
    typography: "{typography.card-title}"
  sheet-row:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  inactive-filter:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.secondary}"
    typography: "{typography.control}"
  active-filter:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
  field-hint:
    backgroundColor: "{colors.input}"
    textColor: "{colors.muted}"
    typography: "{typography.metadata}"
  directory-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
```

### Component selection

| Requirement | Shared component or pattern |
| --- | --- |
| Page title and actions | `PageHeader` |
| Submission or destructive action | `Button` with the applicable variant |
| Navigation action | `ButtonLink` or a semantic link |
| Named icon action | `IconButton` |
| Search | `SearchField` |
| Filters and sections | `SectionNav` and `SectionLink` |
| Tasks and Reading | `ItemRow`, `DragHandle`, and `DragPreview` |
| Directory entries | Divided `ItemList` with preview rows |
| Forms and labels | `FormField`, `FormDialog`, and `DialogHeading` |
| Page actions | `ActionMenu`, `ActionRow`, and `ActionRowLink` |
| Settings | `SettingsSection`, `SettingRow`, and `SettingsGroup` |
| Errors and recovery | `StatusMessage`, `EmptyState`, and `ListPlaceholder` |
| Conversations and drafts | Shared conversation panel and message composer |

Use SVG interface icons with `currentColor`.
Use the parent control's semantic foreground colour.
Use 1.75px to 2px strokes, or filled SVG shapes where appropriate.
Preserve emoji and other characters in user content.
Do not use text glyphs as interface icons.

Use recessed surfaces for short fields and white surfaces for longer editors.
Show clear focus indicators on both.
Disabled buttons require actual disabled behaviour, not only muted colours.
Embedded icons, completion controls, links, and disclosure rows do not need standalone button borders.

### Lists and reordering

Keep task and Reading cards distinct from directory rows.
Show drag handles on items that users can reorder.
Use existing application reorder operations for pointer and keyboard input.
Update persistent state, preserve focus, and announce the result.
Do not reorder only DOM elements.
Preserve pending edits and provide recovery when saving fails.
Do not restore the obsolete Edit list mode.

### Dialogs and focus

Use the Actions trigger and Page actions dialog title.
Use mobile sheets for page actions, navigation, and conversation settings.
Retain appropriate desktop dialog layouts.
Keep native dialog focus trapping and focus restoration.
Support Escape and the applicable backdrop dismissal rules.
Prevent dismissal when an operation requires it to protect submitted work.
Preserve editable content after validation or save failures.
Use native radio inputs with visible focus on their associated controls.
Labels can wrap inputs or reference their IDs.
Voice and attachment controls must not submit forms.

### Connection status

Keep the compact badge in navigation.
Use SVG indicators for synced, pending, and attention states.
Detailed status must retain checking, syncing, waiting, warning, offline, and synced distinctions.
Expose connection details and recovery actions from the navigation status control.
Distinguish Herts connection failure, Hermes unavailability, conflicts, and device storage failures.
Do not restrict necessary recovery messages to the badge.

### Task spaces

Any space can become the default.
The current default cannot be deleted.
Users must choose another default before deleting that space.
The original space has no permanent deletion protection.
Delete another space only when existing content and draft safeguards permit deletion.
Keep server checks and confirmation before deletion.
Include Done and Snoozed tasks in emptiness checks.
Protect saved recordings, local drafts, and concurrent changes.
Do not silently select a different default during deletion.

### Loading and recovery

Specify loading, empty, filtered-empty, offline, cached, failure, and retry states for each affected workflow.
Keep drafts available offline.
Distinguish an unavailable server from a missing record.
Ignore obsolete responses and preserve edits during delayed reads or submissions.
Protect drafts until acknowledgement completes.
Never automatically repeat remote actions with unknown outcomes.
Use explicit recovery actions and keep failure messages beside affected controls.

## Do's and Don'ts

- Use this document as the design authority.
- Generate application tokens from its structured values.
- Do not edit generated token files directly.
- Do not change design rules merely to accept an implementation difference.
- Preserve shared components, semantic styling, and accessible controls.
- Review actual screenshots instead of relying only on bounds checks.
- Test realistic long content and recovery states with isolated synthetic data.
- Do not use live bots or model prompts for validation.

Follow the [UI completion criteria](AGENTS.md#ui-completion-criteria) and [test selection policy](docs/testing.md#test-selection-policy).
Validate the standard format, token references, generated output, and required contrast pairs.
Checks must report stale generated output instead of silently accepting it.
Record the validator version and results.
Run `npm run check:docs` after documentation changes.
Review technical meaning and approved vocabulary separately.
A passing automatic check is not full STE certification or proof of visual consistency.
