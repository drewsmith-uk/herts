import { builtinThemes, defaultTheme, themeProperties, themeStorageKey, type Theme } from '../shared/themeValues';

export function readAppearance(): { theme: Theme; catalogue: Theme[]; notice: string } {
  const fallback = { theme: defaultTheme, catalogue: builtinThemes, notice: '' };
  try {
    const raw = localStorage.getItem(themeStorageKey);
    if (!raw || raw.length > 512 * 1024) return fallback;
    const saved = JSON.parse(raw);
    const theme = builtinThemes.find(theme => theme.id === saved?.id);
    if (theme) return { ...fallback, theme };
    return { ...fallback, notice: typeof saved?.id === 'string' ? 'This theme is no longer available. Press is selected.' : '' };
  } catch { return fallback; }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(themeProperties(theme))) root.style.setProperty(property, value);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
  root.style.backgroundColor = theme.colors.background;
  root.style.color = theme.colors.text;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.background);
  document.getElementById('herts-theme-fonts')?.remove();
}
