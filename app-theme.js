/* The dark appearance is the default; the user's explicit choice belongs to this device. */
(() => {
  'use strict';
  const KEY = 'nujoomAppTheme';
  const root = document.documentElement;
  const choices = [...document.querySelectorAll('input[name="app-theme"]')];
  function apply(value, save = false) {
    const theme = value === 'light' ? 'light' : 'dark';
    const background = theme === 'light' ? '#edf3f7' : '#192c3f';
    root.dataset.theme = theme;
    root.style.backgroundColor = background;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent');
    for (const choice of choices) choice.checked = choice.value === theme;
    if (save) {
      try { localStorage.setItem(KEY, theme); } catch (_) { /* The appearance still changes when storage is unavailable. */ }
    }
  }
  apply(root.dataset.theme);
  for (const choice of choices) choice.addEventListener('change', () => {
    if (choice.checked) apply(choice.value, true);
  });
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) apply(event.newValue);
  });
})();
