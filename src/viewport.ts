/**
 * The game's drawing area, and the installed-app (home screen) adjustments.
 *
 * iOS home-screen apps (status bar `black-translucent`, viewport-fit=cover) can
 * report a viewport shorter than the screen by the status bar's height, which
 * left an empty band under the bottom bar. There the full screen height is
 * known exactly, so the app area uses it (`--app-h`, read by style.css).
 *
 * As an installed app, `html.app` is set, and style.css adds a little room
 * under the status bar (`--safe-top`) so the top HUD isn't against it.
 */
const iosApp = (navigator as { standalone?: boolean }).standalone === true;
const installed = iosApp || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

/** Height of the drawing area in CSS px: use this, not innerHeight. */
export function viewH(): number {
  if (!iosApp) return innerHeight;
  // iOS reports screen size in portrait whatever the orientation
  const landscape = innerWidth > innerHeight;
  const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  // only ever grow it, and only by up to a status bar or so: never trust a wildly different number
  return full > innerHeight && full - innerHeight <= 80 ? full : innerHeight;
}

function apply() {
  document.documentElement.style.setProperty('--app-h', `${viewH()}px`);
}

if (installed) document.documentElement.classList.add('app');
apply();
addEventListener('resize', apply);
addEventListener('orientationchange', () => setTimeout(apply, 300));
