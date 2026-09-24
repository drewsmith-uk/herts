import { builtinThemes, defaultTheme, themeProperties, isTheme, themeStorageKey, maxThemeCount, type Theme } from '../shared/themeValues';

export function readAppearance(): { theme: Theme; catalogue: Theme[] } {
  try {
    const raw = localStorage.getItem(themeStorageKey);
    if (!raw || raw.length > 512 * 1024) throw new Error('No saved appearance');
    const saved = JSON.parse(raw);
    if (!isTheme(saved.theme) || saved.id !== saved.theme.id) throw new Error('Invalid saved appearance');
    const custom: Theme[] = [];
    if (Array.isArray(saved.catalogue)) for (const value of saved.catalogue.slice(0, maxThemeCount)) {
      if (isTheme(value) && !builtinThemes.some(t => t.id === value.id) && !custom.some(t => t.id === value.id)) custom.push(value);
    }
    const theme = builtinThemes.find(t => t.id === saved.id) || saved.theme;
    if (!builtinThemes.some(t => t.id === theme.id) && !custom.some(t => t.id === theme.id)) custom.push(theme);
    return { theme, catalogue: [...builtinThemes, ...custom] };
  } catch { return { theme: defaultTheme, catalogue: builtinThemes }; }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(themeProperties(theme))) root.style.setProperty(property, value);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
  root.style.backgroundColor = theme.colors.background;
  root.style.color = theme.colors.text;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.background);
  let fonts = document.getElementById('herts-theme-fonts');
  if (!fonts) { fonts = document.createElement('style'); fonts.id = 'herts-theme-fonts'; document.head.append(fonts); }
  fonts.textContent = theme.fonts.map(font => `@font-face{font-family:"${font.family}";src:url("${font.href}") format("woff2");font-weight:${font.weight};font-style:${font.style};font-display:swap}`).join('\n');
}
