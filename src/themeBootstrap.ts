// Built as a small, blocking same-origin script. Runs before the app body is parsed,
// including offline, without waiting for React, IndexedDB or a server catalogue.
import { applyTheme, readAppearance } from './themeAppearance';
applyTheme(readAppearance().theme);
