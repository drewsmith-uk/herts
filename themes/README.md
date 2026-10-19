# Herts appearance

Press is the only available theme.
The app has no theme selector.
Previous selections resolve to Press before the app renders, including offline.

[DESIGN.md](../DESIGN.md) defines the intended appearance.
Run `npm run design:generate` after an approved token change.
Run `npm run check:design` to validate references, contrast, and generated output.
Do not edit generated Press values directly.

Inter ships with the browser assets and remains available offline after caching.
The build includes its licence in THIRD_PARTY_NOTICES.txt.
System fonts remain available while Inter loads.

## Retained theme infrastructure

Inactive theme definitions remain in this directory for possible future use.
Shared semantic variables, theme application code, and the appearance storage key remain available.
The theme API returns Press for current and older clients.
Restoring theme selection requires an explicit design decision and UI verification.
Custom theme files and custom font endpoints remain unsupported.

## Plugin styling

Use shared components and semantic variables.
Do not copy Press colours into plugins.

```css
.plugin-panel {
  color: var(--color-text);
  background: var(--color-surface);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-panel);
  font-family: var(--font-body);
}
```
