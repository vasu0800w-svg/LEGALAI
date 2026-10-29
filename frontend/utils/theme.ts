export const THEME_INK_DARK = '#0a0a0a';

/** Lock the signed-in app to Casemate’s original dark chrome. The landing page sets its own light look. */
export const lockOriginalAppearance = (): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_INK_DARK);
  try {
    localStorage.removeItem('casemate_theme');
    localStorage.removeItem('casemate_theme_at');
    localStorage.removeItem('casemate_theme_chosen');
  } catch {
    /* ignore */
  }
};
