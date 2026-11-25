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

/**
 * Is a newer release live than the one running? Compares the page's entry script (its name carries a content hash)
 * with the one in a fresh copy of the page. False offline, in dev, or on any doubt.
 */
export async function newVersionReady(page = ''): Promise<boolean> {
  if (!import.meta.env.PROD) return false;
  const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src');
  if (!mine) return false;
  try {
    // `page`: the page to compare with (the game's by default; the editor passes 'editor.html', its own entry)
    const res = await fetch(`${import.meta.env.BASE_URL}${page}?check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const html = await res.text();
    const theirs = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/)?.[1] ?? html.match(/src="([^"]*\/assets\/main-[^"]+\.js)"/)?.[1];
    return !!theirs && theirs !== mine;
  } catch { return false; }
}

/** Load the newer release: refresh the service worker, then the page. */
export async function updateNow() {
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* reload anyway */ }
  location.reload();
}
