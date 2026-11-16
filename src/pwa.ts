/**
 * Installable app: registers the service worker (dist/sw.js, built by
 * vite.config.ts from src/sw-template.js) so the game can be added to a home
 * screen and keeps working offline. Production builds only: in dev it would
 * cache the dev server's files and get in the way.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).get('sw') === '0') return; // ?sw=0 for debugging without it
  // after the game has loaded, so precaching doesn't compete with the first boot
  const go = () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('service worker:', e));
  if (document.readyState === 'complete') setTimeout(go, 3000);
  else addEventListener('load', () => setTimeout(go, 3000), { once: true });
}
