import { viewH } from './viewport';
import * as THREE from 'three';
import './style.css';
import { VIEWS, ZoomCamera, type ViewName } from './camera';
import { Input } from './input';
import { CAMPAIGN, getSave, migrateAutosave, playable, putSave, regionKey, wipeCampaign, type AutoSave, type CampaignSave } from './save';
import { applyShared, HOME_REGION, type SharedState } from './sim/campaign';
import { SimClient } from './sim/client';
import { TICK_HZ, type Building, type PlaySetup, type SimState, type Snapshot } from './sim/types';
import { biomeOf } from './content/nature';
import { content, contentIssues, onContentHot, type RegionDef } from './content';
import { ENDINGS, PREVIEW_KEY, expeditionOf, type CameraKeyDef, type CinematicDef, type InterfaceDef, type MissionDef, type StoryDef } from './content/defs';
import { applyInterface } from './ui-theme';
import { lerp, smoothstep } from './world/noise';
import { buildAtmosphere, E, globeMesh, HALF, N, R, U, regionHeight, regionHeightRaw, regionTerrain, regionToWorld, setRegionTerrain, type GlobeArrays } from './world/planet';
import { Provinces, type ProvinceData } from './world/provinces';
import { RegionView, groundTextures } from './world/region';
import { STAR_R, SolarSystem } from './world/system';
import { SunFlare } from './world/flare';
import { Dust, type Mover } from './world/dust';
import { Weather } from './world/weather';
import { startSkirmish } from './skirmish/mode';
import { skirmishFromUrl } from './skirmish/setup';
import { openSkirmishSetup } from './skirmish/setup-screen';
import { Landing } from './landing';
import { Cinematic, type CineHooks } from './cinematic';
import { loadModel } from './assets/models';
import { ColonyHud } from './colony-hud';
import { StoryHud } from './story-hud';
import { Inspector, LIVE_COLLECTIONS } from './inspector';
import { FogView, addFog } from './world/fog';
import { SkyEnv, type SkyLook } from './world/envmap';
import { atmosUniforms } from './world/atmos';
import { PerfReport } from './perf-report';
import { wearUniforms } from './world/wear';
import { SunShadows } from './world/sunshadow';
import { enableColonyLights } from './world/lights';
import { AA_MODES, HEAT_MAX, Post, gradeFor, type AAMode } from './world/post';
import { GroundMarks, Sky, type MarkMover } from './world/ground';
import { openInfo, openMenu, openOptions, panelOpen, type OptionRow, type Toggle } from './options';
import { ArmyView } from './skirmish/view';
import { ColonistView } from './world/colonists';
import { InhabitantView } from './world/inhabitants';
import { DEFS as UNIT_DEFS, type SkSnapshot } from './skirmish/types';
import { gateSnap, linePoints, placeProblem } from './sim/rules';
import { campSites } from './sim/inhabitants';
import { START_HOUR, hourAt, sunAngle } from './sim/daylight';
import type { RegionUi } from './world/region';
import { GameAudio, type Spatial } from './audio';
import { TitleScreen, type TitleChoice } from './title';
import { VERSION } from './changelog';
import { chronicleModel, openChronicle } from './chronicle';
import { claimDaily, dailyDate, dailyLink, dailyRecord, dailyRivals, dailyRules, dailyScore, dailyStreak, DailyTracker, resultHtml, saveDaily, shareResult, shareText, type DailyResult, type DailyRules } from './daily';
import { hasUnseen, openWhatsNew } from './whatsnew';
import { configureGuide, GuideTips, offerTour, openGuide, setTipsWanted, tipsWanted, toured, tourActive } from './guide';
import { registerServiceWorker } from './pwa';
import { updateWater } from './world/water';
import { ClimaxView, endingsReached, scrambleIn } from './climax-view';
import type { FactionState, LogStyle } from './sim/types';
import { AutopilotView, loadPrefs } from './autopilot';
import { POLICIES, type ChoicePolicy } from './sim/choices';
import { surfaceUniforms, addSurfaceDetail, buildClouds, setSurfaceMaps, updateClouds, updateSurface, type SurfaceMaps } from './world/surface';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- loading screen (markup + styles are inline in index.html) ----------
const loaderEl = $('loader');
/** Show a loading step and let the browser paint it before the next chunk of work. */
/**
 * Loading steps with typical durations (ms, measured on hive1). Only the
 * proportions matter: the bar's share of each step comes from these, and the
 * time it takes to creep across a step is scaled by how fast this device did the
 * steps so far, so it keeps moving smoothly instead of jumping.
 */
const STEPS: [string, number][] = [
  ['Shaping the landing site…', 50],
  ['Charting the solar system…', 200],
  ['Growing alien flora…', 200],
  // the globe and provinces are generated in a worker in parallel with the steps above
  ['Forming the planet…', 125],
  ['Mapping regions…', 5],
  ['Building the base…', 25],
  ['Warming up shaders…', 90],
  ['Starting the simulation…', 40],
];
/** Where the bar was when the code finished loading (the CSS-only creep before that). */
let loadFrom = 0.02;
const REF_TOTAL = STEPS.reduce((m, s) => m + s[1], 0);
const loadTimes: [string, number][] = [['code loaded', performance.now()]];
(window as unknown as { __loadTimes: typeof loadTimes }).__loadTimes = loadTimes;
let stepIdx = -1, refDone = 0, firstStepAt = 0;
const barI = $('loader-bar');
/**
 * The bar moves linearly, so where it is at any moment is known exactly here
 * even though the compositor animates it while this thread is busy. (Reading it
 * back from the browser after a long task can be stale, which made it jump back.)
 */
const bar = { from: 0.02, to: 0.02, start: 0, dur: 1 };
const barAt = (now: number) => bar.from + (bar.to - bar.from) * Math.min(1, Math.max(0, (now - bar.start) / bar.dur));
function barTo(frac: number, ms: number) {
  const now = performance.now();
  const from = barAt(now);
  barI.style.animation = 'none';
  barI.style.transition = 'none';
  barI.style.transform = `scaleX(${from.toFixed(4)})`;
  void barI.offsetWidth; // commit the start before animating from it
  Object.assign(bar, { from, to: Math.max(from, frac), start: now, dur: Math.max(1, ms) });
  barI.style.transition = `transform ${Math.round(ms)}ms linear`;
  barI.style.transform = `scaleX(${bar.to.toFixed(4)})`;
}
/** Show the next loading step and let the browser paint it before the work starts. */
async function loadStep(text: string) {
  const now = performance.now();
  loadTimes.push([text, now]);
  if (stepIdx < 0) {
    // take over from the CSS-only creep (main thread is idle here, so this read is accurate)
    const m = getComputedStyle(barI).transform.match(/matrix\(([^,]+)/);
    const v = m ? Math.max(Number(m[1]), 0.02) : 0.02;
    Object.assign(bar, { from: v, to: v, start: now, dur: 1 });
    loadFrom = v;
    firstStepAt = now;
  } else refDone += STEPS[stepIdx][1];
  stepIdx = Math.min(stepIdx + 1, STEPS.length - 1); // steps run in STEPS order (labels may differ, e.g. skirmish)
  // how much slower (or faster) than hive1 this device has been so far
  const speed = refDone > 0 ? Math.min(20, Math.max(0.5, (now - firstStepAt) / refDone)) : 1;
  const ref = STEPS[stepIdx][1];
  const end = loadFrom + (1 - loadFrom) * ((refDone + ref) / REF_TOTAL) * 0.985;
  $('loader-step').textContent = text;
  barTo(end, ref * speed * 1.2);
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
function loaderError(msg: string) {
  const step = document.getElementById('loader-step');
  if (!step) return; // loader already gone (e.g. the content-error screen replaced it)
  step.className = 'step err';
  step.textContent = `Something went wrong while loading: ${msg}`;
}
addEventListener('error', (e) => { if (!document.body.classList.contains('loaded')) loaderError(e.message); });
addEventListener('unhandledrejection', (e) => { if (!document.body.classList.contains('loaded')) loaderError(String(e.reason?.message ?? e.reason)); });

if (contentIssues.length) {
  // Bad content: say exactly what's wrong instead of starting a half-broken game.
  const el = document.createElement('pre');
  el.id = 'content-issues';
  el.textContent = `Content errors — fix these in the editor (/editor.html) or in /content:\n\n${contentIssues
    .map((i) => `${i.path}${i.field ? ` · ${i.field}` : ''}: ${i.msg}`)
    .join('\n')}`;
  document.body.appendChild(el);
  loaderEl.remove();
  throw new Error(`content: ${contentIssues.length} issue(s)`);
}
const skirmishMode = params.get('mode') === 'skirmish';
// ---------- which region ----------
// ?region=<id> picks one (the title's REGION choice, the editor's Play test);
// otherwise the autosave's region, so CONTINUE lands where you left off.
// ?scratch=1 neither reads nor writes the autosave; ?preview=1 plays the region
// the editor's Play test button left in localStorage (unsaved edits included).
const preview = params.get('preview') === '1' ? readPreview() : null;
/** ?skirmish=<seed>: you against computer players on a generated map (src/skirmish/setup.ts lists the options). */
const rts = !skirmishMode && params.has('skirmish') ? skirmishFromUrl(params, content.bodies) : null;
const scratch = params.get('scratch') === '1' || !!preview || !!rts;
function readPreview(): { id: string; def: RegionDef; story?: { id: string; def: StoryDef }; mission?: { id: string; def: MissionDef }; setup?: PlaySetup; cinematic?: { id: string; def: CinematicDef }; interface?: InterfaceDef } | null {
  try {
    const p = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? 'null');
    return p?.id && p.def ? p : null;
  } catch { return null; }
}
/**
 * ?land=1: NEW GAME in another region (chosen in the title's Options) loads that region and lands at once,
 * a fresh colony. Taken out of the address straight away, so reloading later doesn't wipe the new save.
 */
const landHere = params.get('land') === '1';
if (landHere) { const u = new URL(location.href); u.searchParams.delete('land'); history.replaceState(history.state, '', u); }
/**
 * ?travel=1: arriving from campaign travel (src/sim/campaign.ts): straight into the region, no title, its own
 * save if it has one, otherwise a fresh expedition with the campaign's shared state. Taken out of the address too.
 */
const travelIn = params.get('travel') === '1' && !scratch && !skirmishMode;
if (params.has('travel')) { const u = new URL(location.href); u.searchParams.delete('travel'); history.replaceState(history.state, '', u); }
// ---------- the campaign: one save per region, one shared state (TECH.md "Campaign travel") ----------
let campaign: CampaignSave | undefined;
if (!skirmishMode && !scratch) {
  if (params.get('new') === '1' || landHere) await wipeCampaign().catch(() => {});
  else {
    await migrateAutosave().catch((e) => console.warn('autosave migration failed', e));
    campaign = await getSave<CampaignSave>(CAMPAIGN).catch(() => undefined);
    if (campaign?.version !== 1 || !content.regions[campaign.current]) campaign = undefined;
  }
}
/** A region's own save, if it has one worth resuming (never in a scratch game). */
const regionSave = async (id: string) => (skirmishMode || scratch ? undefined : await getSave<AutoSave>(regionKey(id)).then((a) => (playable(a) ? a : undefined)).catch(() => undefined));
// the campaign's current region, unless its colony is gone (a lost expedition): then home
let savedRegion = campaign?.current ?? HOME_REGION;
if (campaign && savedRegion !== HOME_REGION && !travelIn && !(await regionSave(savedRegion)) && (await regionSave(HOME_REGION))) savedRegion = HOME_REGION;
const askedRegion = params.get('region');
const regionId = rts ? 'skirmish' : preview ? preview.id : askedRegion && content.regions[askedRegion] ? askedRegion : content.regions[savedRegion] ? savedRegion : HOME_REGION;
/** This region's save, with the campaign's shared state laid over it when that is newer (you've been elsewhere since). */
const hereSave = rts || preview ? undefined : await regionSave(regionId);
if (hereSave && campaign?.shared && campaign.savedAt > hereSave.savedAt) applyShared(hereSave.sim, campaign.shared, regionId);
/** The colony saved in the campaign's current region when that isn't this one (CONTINUE goes there). */
const elseSave = !hereSave && savedRegion !== regionId ? await regionSave(savedRegion) : undefined;
let autosaved: AutoSave | undefined = hereSave ?? elseSave;
/** A fresh game here still carries the campaign's story, missions and research (a first visit). */
const freshShared: SharedState | undefined = !hereSave && campaign?.shared ? campaign.shared : undefined;
/** A region you travel to: starts deployed with its expedition package (no landing). */
const expedition = !rts && !preview ? expeditionOf(content.regions[regionId]) : undefined;
/** ?biome=<id> tries another biome's plants and wildlife on this region (the sim plays the region with it). */
const biomeParam = params.get('biome');
const biomeTest = !!biomeParam && !!content.biomes[biomeParam];
const regionDef: RegionDef = rts ? rts.map.region : biomeTest ? { ...(preview?.def ?? content.regions[regionId]), biome: biomeParam! } : preview?.def ?? content.regions[regionId];
/** Terrain look: ?look=flat|smooth, else what the player chose last (Options → Terrain look), else flat. */
const LOOK_KEY = 'exo.look';
let look: 'flat' | 'smooth' = (() => {
  const q = params.get('look');
  if (q === 'smooth' || q === 'flat') return q;
  // Smooth by default (since v0.79.0); a player who picked Flat keeps it
  try { return localStorage.getItem(LOOK_KEY) === 'flat' ? 'flat' : 'smooth'; } catch { return 'smooth'; }
})();
/** The region's terrain with its body (a planet, moon, asteroid or comet) looked up: every worker gets this. */
const terrain = regionTerrain(regionDef, content.bodies);
const bodyId = regionDef.body && content.bodies[regionDef.body] ? regionDef.body : 'home';
const bodyDef = content.bodies[bodyId];
// Start both workers first so their work overlaps everything below: the sim
// (boots its module graph and a new game) and the globe/province generator.
/** Sim events that arrive before the HUD exists wait here. */
type At = { x: number; z: number } | undefined;
const early: [string, 'info' | 'warn' | 'bad', At, (LogStyle | undefined)?][] = [];
let logFn: ((text: string, level: 'info' | 'warn' | 'bad', at?: At, style?: LogStyle) => void) | null = null;
// sound (colony only; ?sound=0 turns it off for good, the ⋯ menu for now)
const audio = new GameAudio(content.sound, content.assets, skirmishMode || params.get('sound') === '0', content.music);
const sim = new SimClient((t, l, cue, at, style) => {
  if (cue) audio.event(cue);
  if (logFn) logFn(t, l, at, style); else early.push([t, l, at, style]);
}, !skirmishMode, regionId, biomeTest || rts ? regionDef : preview?.def, preview?.story, preview?.mission, preview?.cinematic?.def.scene === 'landing' ? undefined : preview?.cinematic, rts?.setup, freshShared);
// the editor's story play test: its (maybe unsaved) event, fired once the colony deploys
if (preview?.story) content.story[preview.story.id] = preview.story.def;
if (preview?.mission) content.missions[preview.mission.id] = preview.mission.def;
const fireStory = preview?.story?.id ?? params.get('story');
// ?cinematic=<id> (or the editor's play test) plays a cinematic once the colony deploys
const fireCine = preview?.cinematic && preview.cinematic.def.scene !== 'landing' ? preview.cinematic.id : params.get('cinematic');
if (preview?.cinematic && preview.cinematic.def.scene !== 'landing') content.cinematics[preview.cinematic.id] = preview.cinematic.def;
let storyFired = false;
const startMission = preview?.mission?.id ?? params.get('mission');
const gen = new Promise<{ globe: GlobeArrays; prov: ProvinceData; ms: Record<string, number> }>((res, rej) => {
  const w = new Worker(new URL('./world/gen-worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e) => { res(e.data); w.terminate(); };
  w.onerror = (e) => rej(new Error(e.message || 'generation worker failed'));
  w.postMessage({ look, region: terrain });
});
await loadStep('Shaping the landing site…');
setRegionTerrain(terrain);

// ---------- renderer / scene ----------
const coarse = matchMedia('(pointer: coarse)').matches;
// anti-aliasing (⚙ Options, src/world/post.ts): the URL (?aa=auto|off|fxaa|smaa|msaa) wins, then what the player chose.
// Read before the canvas is made: its own MSAA is fixed then, so ask for it only when the mode might use it.
const AA_KEY = 'exo.aa';
const aaFromUrl = AA_MODES.includes(params.get('aa') as AAMode) ? (params.get('aa') as AAMode) : null;
let aaStart: AAMode = 'auto';
try { const v = localStorage.getItem(AA_KEY) as AAMode | null; if (v && AA_MODES.includes(v)) aaStart = v; } catch { /* private mode */ }
aaStart = aaFromUrl ?? aaStart;
const renderer = new THREE.WebGLRenderer({ antialias: aaStart === 'auto' || aaStart === 'msaa', logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
// Render scale: starts at the device's (capped) pixel ratio and steps down while
// frames are slow, back up when there's headroom. Phones are fill-bound, so this
// is the big lever. ?dpr=N pins it.
const dprPinned = Number(params.get('dpr')) || 0;
const dprMax = dprPinned || Math.min(devicePixelRatio, coarse ? 1.75 : 2);
const dprMin = Math.min(dprMax, 1);
const res = { scale: dprMax, acc: 0, n: 0, good: 0, hold: false };
renderer.setPixelRatio(dprMax);
/** Called once a frame with the real frame time (unclamped, seconds). */
function adaptRes(rawDt: number) {
  if (dprPinned || res.hold || rawDt > 0.5 || document.hidden) return; // a stall or a background tab, not load (or the performance benchmark holding it)
  res.acc += rawDt; res.n++;
  if (res.acc < 2) return;
  const fps = res.n / res.acc;
  res.acc = 0; res.n = 0;
  let next = res.scale;
  if (fps < 40) { next = Math.max(dprMin, res.scale - 0.25); res.good = 0; }
  else if (fps > 56 && ++res.good >= 3) { next = Math.min(dprMax, res.scale + 0.25); res.good = 0; } // 6 s of headroom
  else if (fps <= 56) res.good = 0;
  if (next !== res.scale) { res.scale = next; renderer.setPixelRatio(next); renderer.setSize(innerWidth, viewH()); post?.resize(); }
}
renderer.setSize(innerWidth, viewH());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / viewH(), 0.2, 1.2e7);
const fog = new THREE.Fog('#8fb0ad', 400, 1200);
scene.fog = fog;
// colony lights: floodlights, headlights, flashes via a top-down light map (src/world/lights.ts).
// On unless ?lights=0 (then never built); the ⋯ menu's Lights button turns them off and on, remembered.
const LIGHTS_KEY = 'exo.lights';
const lights = params.get('lights') === '0' ? null : enableColonyLights(scene);
if (lights) {
  lights.setLooks(content.buildings);
  try { lights.enabled = params.get('lights') === '1' || localStorage.getItem(LIGHTS_KEY) !== 'off'; } catch { /* private mode */ }
}
// glow (bloom, src/world/post.ts): on by default on desktop, off on phones; ⋯ menu ✺ Glow, remembered; ?bloom=0|1 overrides
// (automated browsers default to off: SwiftShader halves the frame rate with it, and tests time things in frames)
const CLOUDS_KEY = 'exo.cloudshadows', MARKS_KEY = 'exo.marks', GRADE_KEY = 'exo.grade';
const GLOW_KEY = 'exo.glow', FLARE_KEY = 'exo.flare', AWAKE_KEY = 'exo.awake', DUST_KEY = 'exo.dust', ZOOMBLUR_KEY = 'exo.zoomblur', WEATHER_KEY = 'exo.weather', SHADOWS_KEY = 'exo.shadows', PRINT_KEY = 'exo.print', WATER_KEY = 'exo.water';
/** A remembered on/off option: the URL (?name=0|1) wins, then what the player chose, then the default. */
function setting(key: string, param: string, dflt: boolean) {
  const q = params.get(param);
  if (q === '0' || q === '1') return q === '1';
  try { const v = localStorage.getItem(key); if (v) return v === 'on'; } catch { /* private mode */ }
  return dflt;
}
function remember(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* private mode */ }
}
const BGPAUSE_KEY = 'exo.bgpause', CURSOR_KEY = 'exo.zoomcursor', EDGE_KEY = 'exo.edgescroll';
/** Pause when the tab or app goes to the background (the sim would carry on without you). */
let bgPause = setting(BGPAUSE_KEY, 'bgpause', true);
let zoomToCursor = setting(CURSOR_KEY, 'zoomcursor', true);
let edgeScroll = setting(EDGE_KEY, 'edgescroll', false);
const post = new Post(renderer, scene, camera);
post.aa = aaStart;
post.enabled = setting(GLOW_KEY, 'bloom', !coarse && !navigator.webdriver);
if (lights) lights.shadows = setting(SHADOWS_KEY, 'shadows', true);
// sky reflections (src/world/envmap.ts): metal reflects the sky, everything picks up its light; Options → Sky reflections; ?reflect=0|1
const REFLECT_KEY = 'exo.reflect';
const skyEnv = new SkyEnv(renderer, scene);
// (off by default in automated browsers, like Glow: on SwiftShader its per-pixel lookups slow every frame, and tests time
// things in frames; ?reflect=1 turns it on there)
skyEnv.enabled = setting(REFLECT_KEY, 'reflect', !navigator.webdriver);
// ambient occlusion (src/world/post.ts, n8ao): on by default on desktop like Glow, off on phones; ?ao=0|1
const AO_KEY = 'exo.ao';
post.ao = setting(AO_KEY, 'ao', !coarse && !navigator.webdriver);
// mist in low ground and haze toward the sun (src/world/atmos.ts, rides the light map's patch); ?mist=0|1
// real sun shadows up close (src/world/sunshadow.ts): desktop by default, off on phones and in automated browsers; ?sunshadows=0|1
const SUNSHADOW_KEY = 'exo.sunshadows';
const sunShadows = new SunShadows(renderer, scene, coarse);
sunShadows.enabled = setting(SUNSHADOW_KEY, 'sunshadows', !coarse && !navigator.webdriver);
const MIST_KEY = 'exo.mist';
let mistOn = setting(MIST_KEY, 'mist', true);
/** Where this region's low ground is (heights above the datum): the mist pools below `base`, thinning over `scale`. */
let mistLevels: { base: number; scale: number } | null = null;
function regionMistLevels() {
  const hs: number[] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) hs.push(Math.max(0, regionHeight((i / n * 2 - 1) * HALF * 0.9, (j / n * 2 - 1) * HALF * 0.9)));
  hs.sort((a, b) => a - b);
  const lo = hs[Math.floor(hs.length * 0.25)], hi = hs[Math.floor(hs.length * 0.75)];
  return { base: lo + 0.35 * (hi - lo), scale: Math.max(3, 0.6 * (hi - lo)) };
}
// colour grade and vignette (src/world/post.ts): Options → Colour grade, remembered; ?grade=0|1
post.grading = setting(GRADE_KEY, 'grade', true);
// the ground weathers (src/world/ground.ts): cloud shadows, wet ground after rain, tracks and scorches. They ride on
// the light map's shader patch, so ?lights=0 leaves them out too
const groundSky = new Sky();
groundSky.cloudShadows = !!lights && setting(CLOUDS_KEY, 'cloudshadows', true);
const marks = lights ? new GroundMarks() : null;
if (marks) marks.enabled = setting(MARKS_KEY, 'marks', true);
groundSky.wetOn = !!marks?.enabled;
// lens flare from the sun (src/world/flare.ts): Options → Lens flare, remembered; ?flare=0|1 overrides
const flare = new SunFlare();
flare.enabled = setting(FLARE_KEY, 'flare', true);
// keep the screen on while the game is open and showing (Screen Wake Lock; the browser drops the lock
// whenever the tab is hidden, so ask again on return). Options → Keep screen on, remembered.
const canWake = 'wakeLock' in navigator;
let keepAwake = setting(AWAKE_KEY, 'awake', true);
let wakeLock: { release(): Promise<void>; released: boolean } | null = null;
async function syncWakeLock() {
  if (!canWake) return;
  const want = keepAwake && document.visibilityState === 'visible';
  try {
    if (want && (!wakeLock || wakeLock.released)) wakeLock = await (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<NonNullable<typeof wakeLock>> } }).wakeLock.request('screen');
    else if (!want && wakeLock && !wakeLock.released) { await wakeLock.release(); wakeLock = null; }
  } catch { /* refused (battery saver, no user gesture yet): try again on the next tap */ }
}
document.addEventListener('visibilitychange', () => void syncWakeLock());
// some browsers only grant it after a tap or key
addEventListener('pointerdown', () => { if (keepAwake && (!wakeLock || wakeLock.released)) void syncWakeLock(); });
void syncWakeLock();

await loadStep('Charting the solar system…');
const system = new SolarSystem(scene, $('labels'), content.bodies, bodyId);
await loadStep(skirmishMode ? 'Raising the battlefield…' : 'Growing alien flora…');
const floraParam = params.get('flora');
const region = new RegionView(
  scene, look,
  skirmishMode || floraParam === 'off' ? null : Number(floraParam ?? regionDef.floraSeed) || regionDef.floraSeed,
  regionDef.floraDensity,
  { defs: content.buildings, buildRadius: content.colony.buildRadius },
  { biome: biomeOf(content, regionDef), wildlife: content.wildlife },
);
if (!skirmishMode) region.setVents(regionDef.vents ?? []);
region.printing = setting(PRINT_KEY, 'print', true);
// detailed water (src/world/water.ts) on desktop, the simple one on phones; ?water=0|1
region.waterDetail = setting(WATER_KEY, 'water', !coarse);
const cam = new ZoomCamera(camera);
// the globe and provinces were generated in a worker meanwhile
await loadStep('Forming the planet…');
const generated = await gen;
const globe = globeMesh(generated.globe, look);
/** The globe's shading for a look: faceted, or smooth and matched to the textured landing patch seen from a distance. */
function globeLook() {
  const mat = globe.material as THREE.MeshStandardMaterial;
  mat.flatShading = look === 'flat';
  const m = look === 'smooth' ? groundTextures().mean : 1;
  mat.color.setRGB(m, m * (look === 'smooth' ? 0.98 : 1), m * (look === 'smooth' ? 0.96 : 1));
  mat.needsUpdate = true;
}
if (look === 'smooth') globeLook();
scene.add(globe);
// detail from orbit: baked surface maps (after startup, see startSurfaceBake), relief, oceans, night glow, clouds
const surfaceOn = params.get('surface') !== '0';
const clouds = buildClouds();
const cloudy = bodyDef?.clouds ?? bodyId === 'home';
if (surfaceOn) { addSurfaceDetail(globe.material as THREE.MeshStandardMaterial); if (cloudy) scene.add(clouds); }
function startSurfaceBake() {
  if (!surfaceOn) return;
  const w = new Worker(new URL('./world/surface-worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<SurfaceMaps & { ms: number }>) => {
    setSurfaceMaps(e.data);
    (window as unknown as { __surfaceMs: number }).__surfaceMs = e.data.ms;
    w.terminate();
  };
  w.postMessage({ region: terrain });
}
await loadStep('Mapping regions…');
const provinces = new Provinces(scene, globe, $('labels'), generated.prov);
(window as unknown as { __genMs: Record<string, number> }).__genMs = generated.ms;
// atmosphere glow: only seen from orbit — fade it out before the camera can enter the shell
// (the body's own colour and strength: an airless body has none)
const airGlow = bodyDef ? bodyDef.atmosphere : '#8fd6ff', airStrength = bodyDef?.atmosphere ? bodyDef.haze ?? 1 : 1.25;
const atmosphere = buildAtmosphere(R * 1.03, airGlow ?? '#000000', airStrength);
atmosphere.visible = !!airGlow;
scene.add(atmosphere);
// fog of war (colony only; ?fog=0 turns it off)
const fogView = new FogView(!skirmishMode && params.get('fog') !== '0');
if (fogView.enabled) { region.enableFog(); addFog(globe.material as THREE.Material); }
await loadStep('Building the base…');

// ---------- HUD ----------
const hudEl = $('hud');
if (params.get('ui') === '0') hudEl.classList.add('hidden');
const logEl = $('log');
// the HUD's look (Rules → Interface; the editor's preview hands over an unsaved one)
const ui_ = preview?.interface ?? content.interface;
applyInterface(ui_);
const heldLog: [string, 'info' | 'warn' | 'bad', At, (LogStyle | undefined)?][] = [];
/** Pings the minimap (set once the HUD exists: early events come before it). */
let pingFn: ((x: number, z: number, color: string) => void) | null = null;
/** Where the latest event with a place happened (H takes the camera there). */
let lastAt: At;
const goTo = (at: { x: number; z: number }) => { cam.lookAtGround(at.x, at.z); if (cam.a > 0.5) cam.setView('surface'); };
function log(text: string, level: 'info' | 'warn' | 'bad' = 'info', at?: At, style?: LogStyle) {
  // a cinematic hides the log; keep events for when it ends
  if (cine) { heldLog.push([text, level, at, style]); return; }
  const el = document.createElement('div');
  el.className = `ev ${level === 'info' ? '' : level}${style ? ` ${style}` : ''}`;
  // the Clause writes in our log format, wrongly: cold, monospaced, scrambled for a moment
  if (style === 'clause') scrambleIn(el, text);
  else el.textContent = text;
  if (at) {
    // somewhere on the map: tap the line to look there; the radar pings it
    el.classList.add('go');
    el.title = 'Show me (H)';
    el.onclick = () => goTo(at);
    if (level !== 'info') lastAt = at;
    pingFn?.(at.x, at.z, level === 'info' ? '#5ff3ff' : '#ff4d5e');
  }
  logEl.appendChild(el);
  while (logEl.children.length > ui_.logLines) logEl.firstElementChild!.remove();
  setTimeout(() => el.classList.add('fade'), Math.max(500, ui_.logSeconds * 1000 - 1500));
  setTimeout(() => el.remove(), ui_.logSeconds * 1000);
}

logFn = log;
for (const [t, l, at, st] of early.splice(0)) log(t, l, at, st);
const ui: RegionUi = { sel: null, drag: null, build: null, ghost: null };
/** Select the first drone once the landing hands over control. */
let selectFirstDrone = true;

// ---------- cinematics (the landing, and story ones) ----------
const cineEl = $('cine');
/** The cinematic playing, if any (the landing, or a world cinematic: the game is paused for it). */
let cine: Cinematic | null = null;
// ---------- resume where you left off ----------
// The sim worker autosaves every few seconds and whenever the page is hidden
// (phones discard background tabs); on the next visit we pick up from there.
// ?new=1 starts fresh. The camera is remembered separately in localStorage.
const CAM_KEY = regionId === HOME_REGION ? 'exo.camera' : `exo.camera.${regionId}`; // each region remembers its own view
function saveCamera() {
  if (title || cine) return; // the title's orbit and cinematics aren't where you play from
  try { localStorage.setItem(CAM_KEY, JSON.stringify({ dist: cam.targetDist, yaw: cam.yaw, pitch: cam.targetPitch, fx: cam.fx, fz: cam.fz })); } catch { /* private mode */ }
}
function restoreCamera() {
  try {
    const c = JSON.parse(localStorage.getItem(CAM_KEY) ?? 'null');
    if (!c) return;
    Object.assign(cam, { yaw: c.yaw, fx: c.fx, fz: c.fz });
    cam.targetDist = c.dist;
    cam.targetPitch = c.pitch;
  } catch { /* ignore */ }
}
/** This region's save (one in the campaign's current region elsewhere is `elsewhere`: CONTINUE goes there). */
const resumed: AutoSave | null = hereSave ?? null;
const elsewhere: AutoSave | null = elseSave ?? null;
const regionLabel = (id: string) => content.regions[id]?.name ?? id;
/** The world a region is on, as a name ("Home", "Sela"). */
const bodyOfRegion = (id: string) => { const b = content.regions[id]?.body; return b && content.bodies[b] ? b : 'home'; };
const bodyLabel = (id: string) => (content.bodies[bodyOfRegion(id)]?.name ?? 'Home').replace(/\b[A-Z]{2,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());

// ---------- campaign travel (TECH.md "Campaign travel") ----------
/** The travel caption over a fade: leaving, then arriving. */
function travelVeil() {
  let el = document.getElementById('travel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'travel';
    el.innerHTML = '<div class="tv-t"></div><div class="tv-s"></div>';
    document.body.appendChild(el);
  }
  return el;
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
let travelling = false;
/** Save this region, make `to` the campaign's current region, and go there (a fade with where you're leaving and going). */
async function travelTo(to: string) {
  if (travelling || !content.regions[to] || to === regionId) return;
  if (scratch || skirmishMode) {
    log(`Travel to ${regionLabel(to)}: not in a play test (it stays in one region)`, 'warn');
    sim.command({ type: 'travelled' });
    return;
  }
  travelling = true;
  saveCamera();
  ui.sel = null;
  setBuild(null);
  const veil = travelVeil();
  veil.querySelector('.tv-t')!.textContent = `Leaving ${regionLabel(regionId)}`;
  veil.querySelector('.tv-s')!.textContent = bodyLabel(regionId);
  document.body.classList.add('travelling');
  cam.setView(bodyOfRegion(to) === bodyOfRegion(regionId) ? 'planet' : 'system');
  requestAnimationFrame(() => veil.classList.add('on'));
  const [ok] = await Promise.all([sim.travel(to), pause(1800)]);
  if (!ok) {
    log('Travel failed: this region could not be saved', 'bad');
    veil.classList.remove('on');
    document.body.classList.remove('travelling');
    cam.setView('surface');
    sim.autosave(true);
    travelling = false;
    return;
  }
  veil.classList.add('swap');
  await pause(350);
  veil.querySelector('.tv-t')!.textContent = `${bodyLabel(to)} · ${regionLabel(to)}`;
  veil.querySelector('.tv-s')!.textContent = bodyOfRegion(to) === bodyOfRegion(regionId) ? 'Overland' : 'By shuttle';
  veil.classList.remove('swap');
  await pause(1300);
  goTravel(to);
}
if (travelIn) {
  // arriving: the caption over black, then the region fades in
  const veil = travelVeil();
  veil.classList.add('on', 'now');
  veil.querySelector('.tv-t')!.textContent = `${bodyLabel(regionId)} · ${regionLabel(regionId)}`;
  veil.querySelector('.tv-s')!.textContent = resumed ? `Back at ${solTime(resumed.sim.tick)}` : expedition ? 'Expedition landing' : '';
  setTimeout(() => { veil.classList.remove('now'); veil.classList.remove('on'); }, 1600);
  setTimeout(() => veil.remove(), 3200);
}
/** Campaign travel: load the region as an arrival, dropping what starts a game a particular way (?new=1 would wipe the campaign). */
function goTravel(id: string) {
  const u = new URL(location.href);
  for (const k of ['new', 'land', 'intro', 'title', 'story', 'mission', 'cinematic', 'cine', 'view', 'scratch', 'preview']) u.searchParams.delete(k);
  u.searchParams.set('region', id);
  u.searchParams.set('travel', '1');
  location.href = u.href;
}
/** Load another region, keeping the other URL options. */
function goRegion(id: string, extra: Record<string, string> = {}) {
  const u = new URL(location.href);
  // always named: with no region in the address the game opens the saved colony's region
  u.searchParams.set('region', id);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  location.href = u.href;
}

/** "Sol 3, 14:22" for a sim tick. */
function solTime(tick: number) {
  const sol = content.colony.solSeconds, secs = tick / TICK_HZ;
  const h = hourAt(secs, sol);
  return `Sol ${Math.floor(secs / sol) + 1}, ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}
/**
 * The title screen comes first unless a URL asks to go straight in:
 * ?title=0 (resume or land as before), ?intro=0, ?new=1, ?view=…, skirmish.
 */
/**
 * Autopilot (spectator mode, TECH.md "Autopilot"): the computer plays the campaign. Started from the title's
 * Options (Watch the computer play) or the game menu; remembered in the browser (`exo.autopilot`), so it stays on
 * across a travel reload, a landing elsewhere or a CONTINUE in another region it started. Never in a skirmish, a
 * play test or a scratch game.
 */
const apAllowed = !skirmishMode && !rts && !scratch;
const apOnAtStart = apAllowed && loadPrefs().on && (travelIn || landHere || params.get('title') === '0');
const useTitle = !skirmishMode && !rts && !landHere && !travelIn && params.get('title') !== '0' && params.get('intro') !== '0' && params.get('new') !== '1' && !params.get('view');
if (useTitle) document.body.classList.add('title');
let title: TitleScreen | null = null;

function startResume() {
  if (!resumed) return;
  sim.load(resumed.sim);
  cam.setView('surface'); // the default; a remembered camera overrides it
  restoreCamera();
  log(`Welcome back · resumed at ${solTime(resumed.sim.tick)} · ⋯ → New game to start over`);
}
/** The hooks a cinematic needs: the overlay, sounds, where things are, who is talking. */
function cineHooks(done: () => void): CineHooks {
  const lineEl = $('cine-line'), fadeEl = $('cine-fade');
  return {
    caption: (title, sub) => { $('cine-title').textContent = title; $('cine-sub').textContent = sub; },
    line: (l) => {
      lineEl.classList.toggle('on', !!l);
      if (!l) return;
      const who = lineEl.querySelector<HTMLElement>('.who')!;
      who.textContent = l.name;
      who.style.color = l.color ?? '';
      who.classList.toggle('none', !l.name);
      lineEl.querySelector<HTMLElement>('.said')!.textContent = l.text;
    },
    fade: (a) => { fadeEl.style.opacity = a.toFixed(3); },
    sound: (asset, volume, music) => audio.clip(content.assets[asset], volume, music),
    target: (k: CameraKeyDef) => {
      const c = sim.cur;
      if (k.target === 'building') {
        const b = c?.buildings.find((x) => x.kind === k.building && x.progress >= 1) ?? c?.buildings.find((x) => x.kind === 'core');
        return b ? { x: b.x, z: b.z } : { x: 0, z: 0 };
      }
      if (k.target === 'storysite') return regionDef.sites?.find((x) => x.id === k.site) ?? null;
      if (k.target === 'camp') return c?.camps.find((x) => x.group === k.group) ?? (regionDef.camps ?? []).find((x) => x.group === k.group) ?? null;
      return null;
    },
    speaker: (character, speaker) => {
      const ch = character ? content.characters[character] : undefined;
      return { name: fillFirst(ch?.name ?? speaker ?? ''), role: ch?.role ? fillFirst(ch.role) : undefined, color: ch?.color };
    },
    fillText: fillFirst,
    bodyPos: (id) => system.bodyPos(id),
    done,
  };
}
/** {first} = the first pod-born colonist's given name. */
const fillFirst = (t: string) => (t.includes('{first}') ? t.replaceAll('{first}', sim.cur?.story.first ?? 'your first colonist') : t);
/** Speed to go back to when a world cinematic ends. */
let cineResume = 1;
function endCine() {
  document.body.classList.remove('cine', 'cine-world', 'cine-bars');
  cineEl.classList.add('gone');
  cine = null;
  for (const [text, level, at, st] of heldLog.splice(0)) log(text, level, at, st);
  // a cinematic's own music hands back to the director (its hour goes with it: the frame reads `cine`)
  audio.releaseMusic();
}
function startLanding() {
  document.body.classList.add('cine');
  const def = preview?.cinematic?.def.scene === 'landing' ? preview.cinematic.def : content.landing;
  if (def.letterbox) document.body.classList.add('cine-bars');
  const piece = new Landing(scene, region, cam, { stage: (s) => sim.command({ type: 'landing', stage: s }) }, def);
  cine = new Cinematic('landing', def, cam, cineHooks(() => { selectFirstDrone = true; endCine(); }), piece);
  if (def.music) audio.holdMusic(def.music);
  // ?cine=<seconds>: start part-way in (the editor's "play from the playhead")
  const from = Number(params.get('cine'));
  if (from > 0) cine.seek(from);
}
/**
 * Cinematics this page has finished but the sim's queue still lists: a cinematic ends mid-frame and the worker hears
 * of it after, so the queue read later that frame is stale (it used to start the cinematic again). Dropped once the
 * queue no longer has them.
 */
const cineFinished = new Set<string>();
/** Play a world cinematic over the game, paused; tell the sim when it's over. */
function playCinematic(id: string, def: CinematicDef, from = 0) {
  if (cine) return;
  cineEl.classList.remove('gone');
  document.body.classList.add('cine', 'cine-world');
  if (def.letterbox !== false) document.body.classList.add('cine-bars');
  cineResume = speed || 1;
  setSpeed(0);
  ui.sel = null;
  setBuild(null);
  cine = new Cinematic(id, def, cam, cineHooks(() => {
    endCine();
    cineFinished.add(id);
    sim.command({ type: 'cinematic', id, done: true });
    setSpeed(cineResume);
  }));
  if (def.music) audio.holdMusic(def.music);
  if (from > 0) cine.seek(from);
}
if (rts) {
  // a skirmish starts deployed: the camera on your Command Core
  const h = rts.setup.homes![0];
  cam.fx = h.x; cam.fz = h.z;
  cam.targetDist = cam.dist = 110;
} else if (!skirmishMode && !useTitle) {
  if (resumed) startResume();
  else if (params.get('intro') === '0' || params.get('view') || travelIn || (expedition && expedition.landing !== 'probe')) sim.command({ type: 'landing', stage: 'deploy' });
  else startLanding();
}
$('cine-skip').onclick = () => cine?.skip();
addEventListener('keydown', (e) => { if (cine && (e.key === 'Escape' || e.key === 'Enter')) cine.skip(); });

// asset models assigned in content replace built-in building models once loaded.
// ?models=new forces the Blender set (content/assets/exo-<kind>.json) where a kind
// has one; ?models=builtin shows the built-in procedural models (to compare).
const previewModels = params.get('models') === 'new';
const builtinModels = params.get('models') === 'builtin';
const modelFor = (kind: string, assigned?: string) =>
  (builtinModels ? undefined : previewModels && content.assets[`exo-${kind}`] ? `exo-${kind}` : assigned);
for (const [kind, d] of Object.entries(content.buildings)) {
  const id = modelFor(kind, d.model);
  if (!id || !content.assets[id] || d.role === 'core') continue;
  loadModel(content.assets[id]).then(
    (m) => region.setBuildingModel(kind, m),
    (e) => console.warn(`${kind} model failed to load; keeping the built-in`, e),
  );
}
// wrecks and relic caches (region map objects) use the exo-wreck / exo-cache assets when there are ones
if (!builtinModels && content.assets['exo-cache']) loadModel(content.assets['exo-cache']).then((m) => region.setCacheModel(m), (e) => console.warn('cache model failed to load', e));
// worker drones (and the ore haulers) use the exo-drone asset when there is one
if (!builtinModels && content.assets['exo-drone']) loadModel(content.assets['exo-drone']).then((m) => region.setDroneModel(m), (e) => console.warn('drone model failed to load', e));
// wildlife and plants: the models this region's biome and herds use (recoloured per species, src/world/recolor.ts)
if (!builtinModels && !skirmishMode) {
  const biome = biomeOf(content, regionDef);
  const ids = new Set<string>();
  for (const w of [...(biome?.wildlife ?? []).map((r) => r.species), ...regionDef.herds.map((h) => h.species)]) {
    const m = w ? content.wildlife[w]?.model : undefined;
    if (m) ids.add(m);
  }
  for (const r of biome?.plants ?? []) if (r.model) ids.add(r.model);
  for (const id of ids) {
    if (!content.assets[id]) continue;
    loadModel(content.assets[id]).then((m) => region.setNatureModels({ [id]: m }), (e) => console.warn(`${id} failed to load; keeping the built-in`, e));
  }
}
if (!builtinModels && content.assets['exo-wreck']) loadModel(content.assets['exo-wreck']).then((m) => region.setWreckModel(m), (e) => console.warn('wreck model failed to load', e));

const canPlace = (kind: string, x: number, z: number) => {
  const c = sim.cur;
  if (!c) return 'not ready';
  if (c.alloys < content.buildings[kind].cost) return `not enough alloys (${content.buildings[kind].cost} needed)`;
  return placeProblem(placeWorld(c), content.buildings, content.colony, kind, x, z);
};
/** What placement rules see: the colony plus the region's static features (vents). */
const placeWorld = (c: { buildings: Building[]; deposits: Snapshot['deposits']; seams?: Snapshot['seams']; camps?: Snapshot['camps'] }) => ({
  // a skirmish: other players' buildings (as far as you've seen them) only keep you from building too close
  buildings: rts ? c.buildings.filter((b) => !b.team) : c.buildings, others: rts ? c.buildings.filter((b) => b.team) : undefined,
  deposits: c.deposits, vents: regionDef.vents ?? [], seams: c.seams ?? [], campSites: campSites(c.camps ?? []),
});
const snapGate = (kind: string, x: number, z: number) => {
  const c = sim.cur;
  return c && content.buildings[kind]?.role === 'gate' ? gateSnap(c, content.buildings, x, z) : null;
};
const isLine = (kind: string) => content.buildings[kind]?.role === 'wall';
function setBuild(kind: string | null) {
  ui.build = kind;
  ui.ghost = null;
  ui.line = null;
  ui.ghostLine = null;
  document.body.classList.toggle('placing', !!kind);
  $('pl-rotate').style.display = kind && !isLine(kind) ? '' : 'none';
  if (kind) {
    if (cam.a > 0.3) cam.setView('surface');
    const d = content.buildings[kind];
    if (isLine(kind)) log(coarse ? `${d.name}: tap where it starts, tap where it ends, tap the end again to build · ✓ Done when finished` : `${d.name}: click where it starts, then where it ends · it chains on · Esc or ✓ Done to stop`);
    else if (d.role === 'gate') log(coarse ? `${d.name}: tap on a wall to drop it in (it lines up and replaces the segments under it), tap again to build` : `${d.name}: hover over a wall line, it snaps in and replaces the segments under it · click to build`);
    else if (d.role === 'geothermal') log(`${d.name}: only on a geothermal vent (the glowing cracks) · ${coarse ? 'tap one, then tap again to build' : 'click one to build'}`);
    else log(coarse ? `Tap the ground to preview the ${d.name}, tap it again to build · ⟳ rotates` : `Click to place the ${d.name} · R rotates · Shift-click to place several · Esc to stop`);
  }
}
function restartGame() {
  // the campaign starts over at home: every other region's save goes (an expedition goes home and lands)
  if (!rts && !scratch) {
    if (regionId !== HOME_REGION) { goRegion(HOME_REGION, { land: '1' }); return; }
    void wipeCampaign([regionKey(HOME_REGION), CAMPAIGN]);
  }
  sim.newGame(Date.now() % 100000);
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.flush(); // overwrite the old autosave right away
  hud.reset();
  storyHud.reset();
  fogView.reset();
  climax?.reset();
  ui.sel = null; setBuild(null);
  selectFirstDrone = true;
  if (rts) { const h = rts.setup.homes![0]; cam.fx = h.x; cam.fz = h.z; }
  // a daily's rematch is practice
  if (daily) { dailyScored = false; dailyTracker = new DailyTracker(); dailyDone = false; document.getElementById('over-daily')?.remove(); log('Daily Planet: practice (not scored)'); }
}
const hud = new ColonyHud({
  defs: content.buildings, units: content.units, research: content.research, inhabitants: content.inhabitants, story: content.story, missions: content.missions, rules: content.colony, people: content.people, ui, cam,
  regions: content.regions, bodies: content.bodies, travel: (id) => void travelTo(id),
  command: (c) => sim.command(c),
  setBuild,
  // (a skirmish: the same map and players again; an expedition lost: back home, the campaign goes on)
  restart: () => {
    // (an ending reached on an expedition, Cycle at the Lantern too, ends the campaign: a new game at home)
    if (!rts && !scratch && regionId !== HOME_REGION && sim.cur?.over && sim.cur.over !== 'won' && !sim.cur.story?.epilogue) { sim.flush(); setTimeout(() => goTravel(HOME_REGION), 600); return; }
    restartGame();
  },
  // automated tests (Playwright) don't stop for story pauses unless they asked for a story (?story=<id>, play test)
  pause: (on) => {
    if (navigator.webdriver && !fireStory) return;
    if (on) { storyResume = speed || 1; setSpeed(0); } else if (speed === 0) setSpeed(storyResume);
  },
  load: () => (rts ? showSkirmishSetup() : void loadGame()),
  log,
  onSelect: (kind, role) => storyHud.selected(kind, role),
  nextIdleDrone: () => nextIdleDrone(),
  cardOpened: () => audio.event('message'),
});
pingFn = (x, z, c) => hud.ping(x, z, c);
/** Tutorial hints, waypoints and camera moves the story asks for. */
const storyHud = new StoryHud({
  cam, command: (c) => sim.command(c),
  screenOf: (x, z, lift = 0) => {
    const v = regionToWorld(x, z, lift).project(camera);
    return v.z > 1 ? null : { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * viewH() };
  },
});
$('b-build').onclick = () => hud.toggleMenu();
if (!skirmishMode) {
  sim.autosave(!scratch);
  // phones throw hidden tabs away: save the moment the page goes to the background
  const flush = () => { sim.flush(); saveCamera(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  // Options → Pause in the background: the colony waits for you
  let bgWas = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (bgPause && speed > 0 && !title && !cine && !navigator.webdriver && sim.cur?.deployed && !sim.cur.over) { bgWas = speed; setSpeed(0, true); }
    } else if (bgWas) {
      log('Paused while you were away · Space or ▶ to carry on');
      bgWas = 0;
    }
  });
  addEventListener('pagehide', flush);
  setInterval(saveCamera, 10000);
}

// the story inspector: play tests (?preview=1) and ?inspect=1; in dev it also takes story edits live
const inspector = !skirmishMode && (preview || params.get('inspect') === '1')
  ? new Inspector({ content, cur: () => sim.cur, command: (c) => sim.command(c), log, travel: (id) => void travelTo(id) })
  : null;
if (inspector) {
  onContentHot((next) => {
    const live = content as unknown as Record<string, Record<string, unknown>>, nx = next as unknown as Record<string, Record<string, unknown>>;
    const changed = Object.keys(nx).filter((k) => JSON.stringify(nx[k]) !== JSON.stringify(live[k]));
    // only story records can change under a running game; anything else restarts it
    if (!changed.length || changed.some((k) => !(LIVE_COLLECTIONS as readonly string[]).includes(k))) return false;
    const patch: Record<string, Record<string, unknown>> = {};
    for (const k of changed) {
      patch[k] = nx[k];
      for (const key of Object.keys(live[k])) delete live[k][key];
      Object.assign(live[k], nx[k]);
    }
    sim.patchContent(patch);
    inspector.liveEdit(changed);
    return true;
  });
}

// playtesting: ?debug=1 → F8 summons the next predator pack now, F9 adds 500 alloys
if (params.get('debug') === '1') {
  addEventListener('keydown', (e) => {
    if (e.key === 'F8') { e.preventDefault(); sim.command({ type: 'debug', wave: true }); log('Debug: pack summoned', 'warn'); }
    if (e.key === 'F9') { e.preventDefault(); sim.command({ type: 'debug', alloys: 500 }); log('Debug: +500 alloys', 'warn'); }
  });
}

let speed = 1;
/** Speed to go back to when a pausing story card closes. */
let storyResume = 1;
/** The player paused (button, Space, [): the PAUSED banner shows. Story cards and the menu pause without it. */
let userPaused = false;
const SPEEDS = [0, 1, 3];
const speedBtns = { 0: $('b-pause'), 1: $('b-play'), 3: $('b-fast') } as Record<number, HTMLElement>;
function setSpeed(s: number, user = false) {
  speed = s;
  userPaused = s === 0 && user;
  sim.setSpeed(s);
  for (const [k, b] of Object.entries(speedBtns)) b.classList.toggle('on', Number(k) === s);
}
/** The autopilot's badge, card reader and camera director (src/autopilot.ts); null where it can't run. */
const autopilot = apAllowed ? new AutopilotView({
  cam,
  pilot: (cfg) => sim.pilot(cfg),
  setSpeed: (n) => setSpeed(n),
  speed: () => speed,
  busy: () => !!title || !!cine || travelling || menuOpen || panelOpen() || tourActive() || !sim.cur?.deployed || !!sim.cur?.over || !!document.getElementById('whatsnew') || !!document.getElementById('chronicle'),
  // the game over: an ending (or the home colony lost: the campaign ends), or an expedition lost (the campaign goes home)
  outcome: () => {
    const c = sim.cur;
    if (!c?.over || !!cine || travelling) return null;
    return c.story?.epilogue || regionId === HOME_REGION || c.over === 'won' ? 'ended' : 'lost-away';
  },
  canvas: renderer.domElement,
  tap: () => audio.play('tap'),
  deselect: () => { if (ui.sel) { ui.sel = null; hud.selected(); } },
}, false) : null;
if (autopilot) {
  sim.onPilot = (st) => autopilot.report(st);
  // on when it was left on and this load carries on its game (travel, a landing or a CONTINUE it started); otherwise off
  autopilot.set(apOnAtStart);
}
// ---------- the Field Guide (src/guide.ts): the panel, the first-game tour and tips ----------
/** Speed to go back to when the guide stops holding the game (the tour, the guide opened from a tip). */
let guideResume: number | null = null;
configureGuide({
  tap: () => audio.play('tap'),
  point: (target, text, actions) => storyHud.point(target, text, actions),
  hold: (on) => {
    if (on && guideResume === null) { guideResume = speed; setSpeed(0); }
    else if (!on && guideResume !== null) { const s = guideResume; guideResume = null; if (speed === 0) setSpeed(s); }
  },
  canTour: () => !skirmish && !rts && !title && !cine && !!sim.cur?.deployed && !sim.cur.over,
});
/**
 * Automated browsers (smoke tests) don't get the offer or tips unless a test asks for them in localStorage
 * (`exo.guide.auto` = on, tools/guide-smoke.mjs): the other smokes time and click things the notes would cover.
 */
const guideAuto = (() => { if (!navigator.webdriver) return true; try { return localStorage.getItem('exo.guide.auto') === 'on'; } catch { return false; } })();
/** The first-game look around: offered on a player's very first game (no saves, never toured), at home. */
let tourOffer = guideAuto && !skirmishMode && !rts && !scratch && !autosaved && !campaign && !toured() && regionId === HOME_REGION;
let offerAt = 0;
/** Tips: on unless turned off in Options (off by default in the editor's play tests). */
let guideTips = tipsWanted(!preview);
const tips = skirmishMode || rts ? null : new GuideTips((page) => openGuide({ page, inGame: true, hold: true }), () => audio.play('tap'));
let watchKey = '';
/** Every frame: the offer once the colony's HUD is up, and tips (the sim watches their triggers). */
let guideLast = 0;
function updateGuide(now: number) {
  // real seconds (the frame's dt is capped for the game; the tips' spacing is wall-clock time)
  const dt = guideLast ? Math.min(1, (now - guideLast) / 1000) : 0;
  guideLast = now;
  const c = sim.cur;
  const playing = !skirmish && !title && !cine && !travelling && !!c?.deployed && !c.over;
  const card = !!document.querySelector('#contact.on') || !!c?.story?.inbox.some((id) => content.story[id]?.style !== 'radio');
  const free = playing && !card && !menuOpen && !panelOpen() && !tourActive() && !storyHud.pointing && !document.getElementById('whatsnew') && !document.getElementById('chronicle');
  if (tourOffer && free && !autopilot?.on && c!.secs >= 4) {
    if (!offerAt) offerAt = now + 1200;
    else if (now >= offerAt) { tourOffer = false; offerTour(); }
  }
  const offering = !!document.getElementById('gd-offer');
  document.getElementById('gd-offer')?.classList.toggle('hold', !free);
  if (!tips) return;
  const on = guideTips && guideAuto && !autopilot?.on && !!c?.deployed;
  const watch = on ? tips.watch() : [];
  const key = watch.join(',');
  if (key !== watchKey && c) { watchKey = key; sim.command({ type: 'guide', watch }); }
  tips.update(c?.story?.tips, free && !offering && !tourOffer, on, dt);
}
$('b-pause').onclick = () => setSpeed(0, true);
$('b-play').onclick = () => setSpeed(1);
$('b-fast').onclick = () => setSpeed(3);
$('paused').onclick = () => setSpeed(1);

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
  b.onclick = () => cam.setView(b.dataset.view as ViewName);
});

interface SaveFile { version: 1; savedAt: number; sim: SimState; camera: { dist: number; yaw: number; pitch: number; fx: number; fz: number } }
async function saveGame() {
  try {
    const state = await sim.save();
    const file: SaveFile = { version: 1, savedAt: Date.now(), sim: state, camera: { dist: cam.targetDist, yaw: cam.yaw, pitch: cam.targetPitch, fx: cam.fx, fz: cam.fz } };
    await putSave('slot1', file);
    log(`Saved · tick ${state.tick}`);
  } catch (err) {
    log(`Save failed: ${(err as Error).message}`, 'bad');
  }
}
async function loadGame() {
  try {
    const file = await getSave<SaveFile>('slot1');
    if (!file) { log('No save in this browser yet', 'warn'); return; }
    cine?.skip();
    sim.load(file.sim);
    Object.assign(cam, { yaw: file.camera.yaw, fx: file.camera.fx, fz: file.camera.fz });
    cam.targetDist = file.camera.dist;
    cam.targetPitch = file.camera.pitch;
  } catch (err) {
    log(`Load failed: ${(err as Error).message}`, 'bad');
  }
}
/** Terrain style, switched in place: the ground, the plants' shading and the globe (remembered). */
function switchLook() {
  look = look === 'smooth' ? 'flat' : 'smooth';
  region.setLook(look);
  globeLook();
  try { localStorage.setItem(LOOK_KEY, look); } catch { /* private mode */ }
  // a ?look= in the address would win on the next visit: keep it in step
  if (params.has('look')) { params.set('look', look); const u = new URL(location.href); u.searchParams.set('look', look); history.replaceState(history.state, '', u); }
}

if (previewModels || builtinModels) for (const d of UNIT_DEFS) {
  const a = content.assets[`exo-${d.id}`];
  if (builtinModels) d.model = undefined;
  else if (a) d.model = a;
}
const skirmish = skirmishMode ? startSkirmish({ scene, renderer, cam, region, log, params }) : null;
$('brand-ver').textContent = `v${VERSION}`;
/** The skirmish setup panel (title SKIRMISH, the game menu); START goes to the game it sets up. */
function showSkirmishSetup(onClose?: () => void) {
  openSkirmishSetup(content.bodies, { base: import.meta.env.BASE_URL, tap: () => audio.play('tap'), onClose });
}
if (rts) document.body.classList.add('rts');

// ---------- Daily Planet (src/daily.ts): a skirmish link with ?daily=<date> ----------
const oceanWorld = (w: string) => !!(content.bodies[w] as { ocean?: boolean } | undefined)?.ocean;
const worldName = (w: string) => (content.bodies[w]?.name ?? w).replace(/\b[A-Z]{2,}\b/g, (x) => x[0] + x.slice(1).toLowerCase());
const daily: DailyRules | null = rts && params.get('daily') ? dailyRules(params.get('daily')!, oceanWorld) : null;
/** Today's scored try (only one a day, only today's date; a reload or a rematch is practice). */
let dailyScored = !!daily && !params.has('practice') && daily.date === dailyDate() && claimDaily(daily.date);
let dailyTracker = daily ? new DailyTracker() : null;
let dailyDone = false;
if (daily) {
  document.body.classList.add('daily');
  log(`Daily Planet #${daily.day} · ${worldName(daily.world)} against ${dailyRivals(daily)} · ${dailyScored ? 'your scored try: win, and sooner is better' : 'practice (not scored)'}`);
}
const dailyUrl = () => `${location.origin}${import.meta.env.BASE_URL}`;
/** Wire a score card's Share button. */
function wireShare(root: HTMLElement, d: DailyRules, r: DailyResult) {
  const btn = root.querySelector<HTMLButtonElement>('.dl-share'), said = root.querySelector<HTMLElement>('.dl-said');
  if (!btn) return;
  btn.onclick = async () => {
    audio.play('tap');
    const how = await shareResult(shareText(d, r, worldName(d.world), dailyUrl()));
    if (said) said.textContent = how === 'copied' ? 'Copied: paste it anywhere.' : how === 'shared' ? 'Shared.' : 'Could not copy here.';
  };
}
/** The game is over: score it (if it's the scored try), keep it, and show the card on the end screen. */
function finishDaily(s: NonNullable<typeof sim.cur>) {
  if (!daily || !dailyTracker || !s.players) return;
  dailyDone = true;
  const won = s.over === 'won';
  const { score, parts } = dailyScore(won, s.secs, s.players[0].stats);
  const result: DailyResult = { won, secs: s.secs, score, parts, line: dailyTracker.line(won) };
  if (dailyScored) saveDaily(daily.date, result);
  const over = $('over');
  let box = document.getElementById('over-daily');
  if (!box) { box = document.createElement('div'); box.id = 'over-daily'; over.insertBefore(box, over.querySelector('.grp')); }
  box.innerHTML = resultHtml(daily, result, worldName(daily.world), !dailyScored);
  if (dailyScored) {
    const n = dailyStreak(daily.date);
    if (n > 1) box.insertAdjacentHTML('beforeend', `<div class="dl-note">${n} days in a row.</div>`);
  }
  wireShare(box, daily, result);
}

const help = $('help');
let helped = false;
const army = skirmish ? null : new ArmyView(scene);
/** A campaign faction's unit or building under a tap (an attack order's target), or null. */
function factionAt(x: number, z: number): number | null {
  const c = sim.cur;
  if (!c?.factions?.length) return null;
  let best: number | null = null, bd = Infinity;
  for (const u of c.units) {
    if (!u.team) continue;
    const d = Math.hypot(u.x - x, u.z - z) - (content.units[u.unit]?.radius ?? 1) - 1.5;
    if (d < 0 && d < bd) { bd = d; best = u.id; }
  }
  if (best !== null) return best;
  for (const b of c.buildings) {
    if (!b.team) continue;
    const d = Math.hypot(b.x - x, b.z - z) - (content.buildings[b.kind]?.clearance ?? 8) / 2;
    if (d < 0 && d < bd) { bd = d; best = b.id; }
  }
  return best;
}
/** Colour by team for the army view: the factions' (the Clause's team 1 among them). */
function factionColors(F: FactionState[]) {
  const out: string[] = ['#5ff3ff'];
  for (const f of F) out[f.team] = f.color;
  for (let i = 0; i < out.length; i++) out[i] ??= '#ff4d5e';
  return out;
}
/** Orbital strikes, the Clause's screen tears and the epilogue (campaign only). */
const climax = skirmish || rts ? null : new ClimaxView(scene, (id) => audio.play(id));
// dust behind movers on dry ground (src/world/dust.ts), tinted by the body's ground; Options → Dust and heat haze
const dust = new Dust(new THREE.Color(bodyDef?.ground?.[1]?.color ?? bodyDef?.ground?.[0]?.color ?? '#b08f6c').lerp(new THREE.Color('#d9c8b0'), 0.35), regionHeightRaw);
dust.enabled = setting(DUST_KEY, 'dust', true);
scene.add(dust.points);
// passing rain and dust storms, for the look (src/world/weather.ts); Options → Weather; ?weather=rain|dust|clear holds one
const weather = new Weather(bodyDef ? !!bodyDef.ocean : true, !!airGlow, params.get('weather'));
weather.enabled = setting(WEATHER_KEY, 'weatheron', true);
scene.add(weather.lines);
/** Zoom blur on fast zooms (Glow on). */
let zoomBlur = setting(ZOOMBLUR_KEY, 'zoomblur', true);
if (army) army.roof = (x, z) => region.roofAt(x, z, 2);
const colonists = skirmish ? null : new ColonistView(region.details);
const natives = skirmish ? null : new InhabitantView(region.details, content.inhabitants, content.assets, fogView.enabled, region.flora);
const input = skirmish ? null : new Input(renderer.domElement, cam, region, ui, {
  move: (drone, x, z) => { audio.play('order'); sim.command({ type: 'move', drone, x, z }); },
  build: (kind, x, z, yaw) => sim.command({ type: 'build', kind, x, z, yaw }),
  isLine,
  linePreview: (kind, x1, z1, x2, z2) => {
    const { pts, yaw } = linePoints(content.buildings[kind], x1, z1, x2, z2);
    const c = sim.cur;
    // check each segment as the sim will: in order, paying as it goes
    let alloys = c?.alloys ?? 0;
    const cost = content.buildings[kind].cost;
    return {
      yaw,
      pts: pts.map((p) => {
        const ok = !!c && alloys >= cost && !placeProblem(placeWorld(c), content.buildings, content.colony, kind, p.x, p.z);
        if (ok) alloys -= cost;
        return { ...p, ok };
      }),
    };
  },
  buildLine: (kind, x1, z1, x2, z2) => sim.command({ type: 'buildLine', kind, x1, z1, x2, z2 }),
  lineStep: (kind) => content.buildings[kind].clearance + 0.02,
  placeProblem: canPlace,
  snap: snapGate,
  // only your own can be picked (a skirmish's other players' are shown, not commanded)
  buildings: () => (sim.cur?.buildings ?? []).filter((b) => !b.team),
  units: () => (sim.cur?.units ?? []).filter((u) => !u.team),
  order: (ids, x, z) => {
    audio.play('order');
    // a tap on a campaign faction's unit or building is an attack order (a neutral one turns hostile)
    const t = factionAt(x, z);
    sim.command(t !== null ? { type: 'attack', ids, target: t } : { type: 'order', ids, x, z });
  },
  riders: (ids, t) => {
    const us = sim.cur?.units ?? [], tu = us.find((u) => u.id === t);
    if (!tu || !content.units[tu.unit]?.carries) return [];
    return ids.filter((id) => { const d = content.units[us.find((u) => u.id === id)?.unit ?? '']; return !!d && !d.carries && (d.move ?? 'ground') === 'ground'; });
  },
  board: (ids, t) => { audio.play('order'); sim.command({ type: 'board', ids, transport: t }); },
  setBuild,
  // the card reads the newest snapshot (the HUD's can be a frame behind: just-made units would drop out of the selection)
  select: () => { if (ui.sel) audio.play('select'); if (sim.cur) hud.cur = sim.cur; hud.selected(); },
  view: (v) => cam.setView(v),
  togglePause: () => setSpeed(speed === 0 ? 1 : 0, true),
  toggleBuildMenu: () => hud.toggleMenu(),
  interacted: () => { if (!helped) { helped = true; setTimeout(() => help.classList.add('gone'), 4000); } },
  say: (t, ok) => { log(t, ok ? 'info' : 'warn'); audio.play(ok ? 'tap' : 'deny'); },
  centre: () => centreOnSelection(),
  nextIdleDrone: () => nextIdleDrone(),
  speedStep: (dir) => {
    if (menuOpen) return;
    const i = Math.max(0, SPEEDS.indexOf(speed));
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
    if (next !== speed) { setSpeed(next, true); audio.play('tap'); }
  },
  showControls: () => { if (!panelOpen() && !menuOpen && !title && !cine) { audio.play('tap'); showControls(); } },
  quickSave: () => { if (rts) log('Skirmish games aren\'t saved', 'warn'); else void saveGame(); },
  closeBuildMenu: () => {
    if (!document.querySelector('#build-menu.open')) return false;
    hud.toggleMenu(false);
    return true;
  },
  lookAt: (x, z) => cam.glideTo(x, z),
  zoomToCursor: () => zoomToCursor,
  edgeScroll: () => edgeScroll,
  placeHint: (text, x, y) => placeHint(text, x, y),
  colonistAt: (x, y) => (colonists && cam.dist < 400 ? colonists.pick(x, y, camera, renderer.domElement.getBoundingClientRect()) : -1),
}, army);
$('pl-rotate').onclick = () => input?.rotate();
$('pl-done').onclick = () => setBuild(null);
if (!skirmish) addEventListener('keydown', (e) => {
  // H: to the latest alert (under attack, something lost, contact)
  if ((e.key === 'h' || e.key === 'H') && lastAt && !(e.target instanceof HTMLInputElement)) goTo(lastAt);
  // X: selected combat units stop and guard where they stand
  if (e.key === 'x' && ui.sel?.kind === 'units' && !(e.target instanceof HTMLInputElement)) { audio.play('order'); sim.command({ type: 'stop', ids: ui.sel.ids }); }
  // G: selected units use their ability (those that have one ready)
  if ((e.key === 'g' || e.key === 'G') && ui.sel?.kind === 'units' && !(e.target instanceof HTMLInputElement) && !e.ctrlKey && !e.metaKey) { audio.play('order'); sim.command({ type: 'ability', ids: ui.sel.ids }); }
});
/** Where the selection is (or the Command Core, with nothing selected): F / Home glides the camera there. */
function centreOnSelection() {
  const c = sim.cur, sel = ui.sel;
  if (!c || cam.a > 0.5) { cam.setView('surface'); }
  if (!c) return;
  let at: { x: number; z: number } | undefined;
  if (sel?.kind === 'drone') at = c.drones.find((d) => d.id === sel.id);
  else if (sel?.kind === 'building') at = c.buildings.find((b) => b.id === sel.id);
  else if (sel?.kind === 'colonist') at = colonists?.at.get(sel.id);
  else if (sel?.kind === 'units') {
    const us = c.units.filter((u) => sel.ids.includes(u.id));
    if (us.length) at = { x: us.reduce((m, u) => m + u.x, 0) / us.length, z: us.reduce((m, u) => m + u.z, 0) / us.length };
  }
  at ??= c.buildings.find((b) => b.kind === 'core' && !b.team);
  if (at) cam.glideTo(at.x, at.z);
}
/** The next idle worker drone (. key, or the drones chip): selected and looked at; busy ones when none are idle. */
let droneCycle = -1;
function nextIdleDrone() {
  const c = sim.cur;
  if (!c) return;
  const mine = c.drones.filter((d) => !d.team);
  if (!mine.length) { log('No worker drones · fabricate one at the Command Core', 'warn'); return; }
  const idle = mine.filter((d) => d.task === 'idle');
  const pool = idle.length ? idle : mine;
  const i = pool.findIndex((d) => d.id === droneCycle);
  const d = pool[(i + 1) % pool.length];
  droneCycle = d.id;
  ui.sel = { kind: 'drone', id: d.id };
  audio.play('select');
  hud.selected();
  if (cam.a > 0.5) cam.setView('surface');
  cam.glideTo(d.x, d.z);
  if (!idle.length) log('Every drone is busy', 'info');
}
/** By the mouse while placing: why the building can't go there. */
const hintEl = $('place-hint');
function placeHint(text: string | null, x: number, y: number) {
  hintEl.classList.toggle('on', !!text);
  if (!text) return;
  if (hintEl.textContent !== text) hintEl.textContent = text;
  hintEl.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 18)}px)`;
}
/** Every key and gesture, in one panel (?, and the menu's Controls). */
function showControls(onClose?: () => void) {
  const row = (k: string, v: string) => `<div class="kb"><span>${k}</span><span>${v}</span></div>`;
  const sec = (t: string) => `<div class="op-sec">${t}</div>`;
  const touch = [
    row('Tap', 'select a drone, unit, colonist or building'),
    row('Drag from a drone', 'send it there'),
    row('Tap ground', 'send the selected drone or units'),
    row('Hold or double-tap a unit', 'select all of that type on screen'),
    row('Hold empty ground, then drag', 'paint over units to select them'),
    row('Drag', 'pan · pinch: zoom · two fingers: rotate and tilt'),
    row('⚔ chip', 'select every combat unit (again: look at them)'),
    row('Radar map', 'tap or drag to look there'),
  ].join('');
  const keys = [
    row('<kbd>W A S D</kbd> / arrows', 'pan (hold <kbd>Shift</kbd>: faster)'),
    row('<kbd>Q</kbd> <kbd>E</kbd>', 'turn the camera'),
    row('Wheel / <kbd>+</kbd> <kbd>−</kbd>', 'zoom (toward the cursor)'),
    row('Right-drag', 'turn and tilt'),
    row('<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>', 'surface · planet · system'),
    row('<kbd>F</kbd> / <kbd>Home</kbd>', 'look at the selection (nothing selected: the Command Core)'),
    row('<kbd>.</kbd>', 'next idle worker drone'),
  ].join('');
  const orders = [
    row('Click', 'select · click ground: send the selection'),
    row('Right-click', 'send the selection there · while placing: stop placing'),
    row('<kbd>Shift</kbd>-click', 'add or remove a unit · place several buildings'),
    row('Double-click a unit', 'all of that type on screen'),
    row('<kbd>Ctrl</kbd>-drag', 'select the units in a box (<kbd>Shift</kbd> too: add them)'),
    row('Hold the button on ground, then drag', 'paint over units to select them'),
    row('<kbd>Ctrl</kbd> <kbd>A</kbd>', 'select every combat unit'),
    row('<kbd>Ctrl</kbd>/<kbd>Shift</kbd> + <kbd>4</kbd>–<kbd>9</kbd>', 'make the selected units a group'),
    row('<kbd>4</kbd>–<kbd>9</kbd>', 'select a group (twice: look at it)'),
    row('<kbd>X</kbd>', 'selected units stop and guard'),
    row('<kbd>G</kbd>', 'selected units use their ability (also the ⚡ button on the unit card)'),
    row('<kbd>B</kbd>', 'build menu · <kbd>R</kbd> rotates while placing'),
    row('<kbd>Esc</kbd>', 'close the build menu, stop placing, deselect · then the menu'),
  ].join('');
  const game = [
    row('<kbd>Space</kbd>', 'pause'),
    row('<kbd>[</kbd> <kbd>]</kbd>', 'slower · faster'),
    row('<kbd>Ctrl</kbd> <kbd>S</kbd>', 'save'),
    row('<kbd>H</kbd>', 'look at the latest alert (or tap a log line with ◎)'),
    row('<kbd>?</kbd>', 'this list'),
  ].join('');
  const guide = '<button class="op-guide">▸ Field Guide: how the game works, page by page</button>';
  const { el: ctl } = openInfo('Controls', coarse
    ? `${guide}${sec('Touch')}${touch}${sec('Keyboard')}${keys}${orders}${game}`
    : `${guide}${sec('Camera')}${keys}${sec('Orders')}${orders}${sec('Game')}${game}${sec('Touch')}${touch}`, onClose);
  ctl.querySelector<HTMLButtonElement>('.op-guide')!.onclick = () => { audio.play('tap'); openGuide(); };
}
/** Selected combat units as the army renderer wants them: slot → generation. */
const armySel = new Map<number, number>();
function syncArmySel() {
  armySel.clear();
  const sel = ui.sel;
  if (sel?.kind !== 'units' || !sim.cur) return armySel;
  for (const u of sim.cur.units) if (sel.ids.includes(u.id)) armySel.set(u.slot, u.id & 0xffff);
  return armySel;
}
const asArmy = (s: NonNullable<typeof sim.cur>) => ({ units: s.army, slots: s.armySlots, fx: s.fx, tick: s.tick } as unknown as SkSnapshot);

const initial = params.get('view') as ViewName | null;
if (initial && initial in VIEWS) cam.setView(initial, true);

addEventListener('resize', () => {
  camera.aspect = innerWidth / viewH();
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, viewH());
  post?.resize();
});

// ---------- HUD refresh ----------
const el = { layer: $('layer'), alt: $('alt'), fps: $('fps') };
function fmtAlt(u: number) {
  const km = u * 0.01; // 1 unit ≈ 10 m
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 10000) return `${Math.round(km).toLocaleString()} km`;
  return `${(km / 1000).toFixed(1)}k km`;
}
let fpsAcc = 0, fpsN = 0, fpsShown = 0;
function updateHud(dt: number, now: number) {
  const s = sim.cur;
  if (s && !skirmish) { hud.update(s, speed, now); if (s.deployed) storyHud.update(s.story); inspector?.update(now); }
  if (s && !skirmish) {
    // an expedition without colonists: no cryo bank or people in the HUD
    document.body.classList.toggle('expedition', !!s.campaign?.expedition);
    // a travel effect: save and go (once the cards and cinematics in the way are done)
    if (s.campaign?.travel && !travelling && !cine && !title && s.deployed) void travelTo(s.campaign.travel);
  }
  if (s && dailyTracker && !dailyDone) { if (s.over) finishDaily(s); else dailyTracker.sample(s); }
  el.layer.textContent = cam.b > 0.5 ? 'SYSTEM' : cam.a > 0.5 ? 'ORBIT' : 'SURFACE';
  el.alt.textContent = cam.a > 0.5 && cam.b < 0.5 && innerWidth >= 640
    ? `${provinces.landCount} REGIONS · ALT ${fmtAlt(cam.altitude())}`
    : `ALT ${fmtAlt(cam.altitude())}`;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsShown = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const scaled = res.scale < dprMax ? ` · ${res.scale}x` : '';
  el.fps.textContent = innerWidth < 640 ? `${fpsShown.toFixed(0)} fps${scaled}` : `${fpsShown.toFixed(0)} fps${scaled} · ${renderer.info.render.calls} draws`;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    const v = b.dataset.view;
    b.classList.toggle('on', (v === 'system' && cam.b > 0.5) || (v === 'planet' && cam.a > 0.5 && cam.b <= 0.5) || (v === 'surface' && cam.a <= 0.5));
  });
}

// ---------- reveal + layout ----------
function reveal() {
  loadTimes.push(['first frame', performance.now()]);
  if (useTitle) showTitle();
  startSurfaceBake();
  $('loader-step').textContent = 'Ready';
  barTo(1, 200);
  document.body.classList.add('loaded');
  loaderEl.classList.add('done');
  setTimeout(() => loaderEl.remove(), 700);
  registerServiceWorker();
}
// panels sit above the bottom bar, whatever height it wraps to
const barEl = $('bar');
const syncBar = () => document.documentElement.style.setProperty('--bar-h', `${barEl.offsetHeight}px`);
new ResizeObserver(syncBar).observe(barEl);
syncBar();

// ---------- sound (in Options) ----------
/** The music volume to go back to when Options turns music on again. */
let musicWas = audio.musicVolume || 1;
const soundLock = () => (audio.disabled ? 'OFF (URL)' : null);
/** Sound and Music in Options (title screen and the game menu's Options). */
const soundToggles: OptionRow[] = [
  {
    id: 'sound', section: 'Sound', label: 'Sound', help: 'Music, alarms and effects',
    get: () => audio.on && !audio.disabled, set: (on: boolean) => audio.setOn(on), locked: soundLock,
  },
  {
    kind: 'slider', id: 'volume', section: 'Sound', label: 'Volume', help: 'Everything',
    get: () => audio.volume * 100, set: (v: number) => { audio.setVolume(v / 100); if (!audio.on) audio.setOn(true); }, locked: soundLock,
  },
  // iPhone ring/silent switch (Safari only: elsewhere the row isn't there)
  ...(GameAudio.hasSession ? [{
    id: 'silent', section: 'Sound', label: 'Sound with silent switch on', help: 'Play the game\'s sound even when the iPhone\'s ring/silent switch is set to silent. Off: the switch mutes it.',
    get: () => audio.throughSilent, set: (on: boolean) => audio.setThroughSilent(on), locked: soundLock,
  } as OptionRow] : []),
  {
    id: 'music', section: 'Sound', label: 'Music', help: 'Quiet ambient music on the title screen and now and then in play; tense when a fight starts.',
    get: () => audio.musicVolume > 0 && !audio.disabled, set: (on: boolean) => audio.setMusicVolume(on ? musicWas : 0), locked: soundLock,
  },
  {
    kind: 'slider', id: 'music-volume', section: 'Sound', label: 'Music volume', help: '',
    get: () => audio.musicVolume * 100,
    set: (v: number) => { audio.setMusicVolume(v / 100); if (audio.musicVolume > 0) musicWas = audio.musicVolume; if (!audio.on) audio.setOn(true); },
    locked: soundLock,
  },
];
// ---------- performance stats (top right: view, altitude, fps, draws) ----------
const STATS_KEY = 'exo-stats';
let statsOn = false;
try { statsOn = localStorage.getItem(STATS_KEY) === 'on' || params.has('stats'); } catch { /* private mode */ }
document.body.classList.toggle('stats', statsOn);
// ---------- options (title screen OPTIONS, ⋯ menu ⚙ Options) ----------
const urlLock = (param: string) => () => (params.has(param) ? 'Set in URL' : null);
const graphicsToggles: Toggle[] = [
  {
    id: 'look', label: 'Terrain look', help: 'Flat: crisp low-poly facets. Smooth: soft shading with ground textures.',
    get: () => look === 'smooth', set: () => switchLook(), state: () => (look === 'smooth' ? 'SMOOTH' : 'FLAT'),
  },
  {
    id: 'glow', label: 'Glow', help: 'Lights, glow strips and gunfire spill soft light. Costs some speed on phones.',
    get: () => post.enabled, set: (v) => { post.enabled = v; remember(GLOW_KEY, v); }, locked: urlLock('bloom'),
  },
  {
    id: 'aa', label: 'Anti-aliasing',
    help: 'Smooths jagged edges. Auto: picks for the device. FXAA: cheapest, a little soft. SMAA: sharp, a little more. '
      + 'MSAA: the smoothest, the most work for the graphics chip. Off (with Glow off) applies after a restart.',
    get: () => post.aa !== 'off',
    set: () => { const m = AA_MODES[(AA_MODES.indexOf(post.aa) + 1) % AA_MODES.length]; post.aa = m; try { localStorage.setItem(AA_KEY, m); } catch { /* private mode */ } },
    state: () => (post.aa === 'auto' ? `AUTO · ${post.aaInUse.toUpperCase()}` : post.aaInUse !== post.aa ? `${post.aa.toUpperCase()} · RESTART` : post.aa.toUpperCase()),
    locked: () => (aaFromUrl ? 'Set in URL' : null),
  },
  {
    id: 'reflect', label: 'Sky reflections', help: 'Metal and glass reflect the sky and catch glints of the sun, and the sky lights everything softly from all round.',
    get: () => skyEnv.enabled, set: (v) => { skyEnv.enabled = v; remember(REFLECT_KEY, v); }, locked: urlLock('reflect'),
  },
  {
    id: 'ao', label: 'Ambient occlusion',
    help: 'Soft shade where things meet the ground and each other: under vehicles, round buildings, in creases and among plants. Costs some speed, most on phones; with it on, edges are smoothed with SMAA.',
    get: () => post.ao, set: (v) => { post.ao = v; remember(AO_KEY, v); }, locked: urlLock('ao'),
  },
  {
    id: 'sunshadows', label: 'Sun shadows',
    help: 'Up close, the sun casts real shadows: vehicles, buildings, plants and hills shade each other and themselves. Zoomed out, the soft ground shadows take over. Costs some speed; off by default on phones.',
    get: () => sunShadows.enabled, set: (v) => { sunShadows.enabled = v; remember(SUNSHADOW_KEY, v); }, locked: urlLock('sunshadows'),
  },
  {
    id: 'mist', label: 'Mist and sun haze',
    help: 'Mist gathers in low ground, thickest round sunrise and sunset, and the haze glows warm toward a low sun. On worlds with air.',
    get: () => mistOn, set: (v) => { mistOn = v; remember(MIST_KEY, v); }, locked: urlLock('mist'),
  },
  {
    id: 'grade', label: 'Colour grade',
    help: 'Each world gets its own colour mood: nights bluer, sunrise and sunset warmer, the corners of the view a little darker. (The colours need Glow or FXAA/SMAA; without them, just the corners.)',
    get: () => post.grading, set: (v) => { post.grading = v; remember(GRADE_KEY, v); }, locked: urlLock('grade'),
  },
  {
    id: 'flare', label: 'Lens flare', help: 'The sun flares across the camera lens when it is in view, fading as a planet or the horizon hides it.',
    get: () => flare.enabled, set: (v) => { flare.enabled = v; remember(FLARE_KEY, v); }, locked: urlLock('flare'),
  },
  {
    id: 'dust', label: 'Dust and heat haze', help: 'Drones and vehicles kick up dust on dry ground; air shimmers above working reactors and generators (shimmer needs Glow).',
    get: () => dust.enabled, set: (v) => { dust.enabled = v; remember(DUST_KEY, v); }, locked: urlLock('dust'),
  },
  {
    id: 'zoomblur', label: 'Zoom blur', help: 'A quick zoom blurs the view for a moment, like a camera lens (needs Glow).',
    get: () => zoomBlur, set: (v) => { zoomBlur = v; remember(ZOOMBLUR_KEY, v); }, locked: urlLock('zoomblur'),
  },
  {
    id: 'weather', label: 'Weather', help: 'Now and then a shower or a dust storm passes over, darkening the sky. Just for the look: it changes nothing in play.',
    get: () => weather.enabled, set: (v) => { weather.enabled = v; remember(WEATHER_KEY, v); }, locked: urlLock('weatheron'),
  },
  {
    id: 'shadows', label: 'Ground shadows', help: 'Buildings, drones and vehicles cast soft shadows that follow the sun.',
    get: () => !!lights?.shadows, set: (v) => { if (lights) lights.shadows = v; remember(SHADOWS_KEY, v); },
    locked: () => (!lights ? 'Off in URL' : urlLock('shadows')()),
  },
  {
    id: 'clouds', label: 'Cloud shadows', help: 'On worlds with air, the shadows of passing clouds drift over the land.',
    get: () => groundSky.cloudShadows, set: (v) => { groundSky.cloudShadows = v; remember(CLOUDS_KEY, v); },
    locked: () => (!lights ? 'Off in URL' : urlLock('cloudshadows')()),
  },
  {
    id: 'marks', label: 'Tracks and wet ground',
    help: 'Vehicles leave tread marks and creatures footprints that fade after a while; wrecked buildings scorch the ground; after rain the ground stays dark and puddled until it dries.',
    get: () => !!marks?.enabled, set: (v) => { if (marks) { marks.enabled = v; groundSky.wetOn = v; remember(MARKS_KEY, v); } },
    locked: () => (!lights ? 'Off in URL' : urlLock('marks')()),
  },
  {
    id: 'print', label: 'Printed construction', help: 'New buildings print from the ground up. Off: a plain construction frame.',
    get: () => region.printing, set: (v) => { region.printing = v; remember(PRINT_KEY, v); }, locked: urlLock('print'),
  },
  {
    id: 'water', label: 'Detailed water', help: 'Rippling, glinting seas with foam lapping the shore. Off: calmer, simpler water that is lighter on phones.',
    get: () => region.waterDetail, set: (v) => { region.waterDetail = v; remember(WATER_KEY, v); }, locked: urlLock('water'),
  },
  {
    id: 'lights', label: 'Colony lights', help: 'Floodlights, headlights and gunfire light the ground at night. Off saves battery on older phones.',
    get: () => !!lights?.enabled, set: (v) => { if (lights) { lights.enabled = v; remember(LIGHTS_KEY, v); } },
    locked: () => (!lights ? 'Off in URL' : null),
  },
];
const interfaceToggles: Toggle[] = [
  {
    id: 'guidetips', section: 'Interface', label: 'Field Guide tips', help: 'The first time something new comes up in play, a small note offers the Field Guide page on it (each one once).',
    get: () => guideTips, set: (v) => { guideTips = v; setTipsWanted(v); },
  },
  {
    id: 'bgpause', section: 'Interface', label: 'Pause in the background', help: 'Pause when you switch to another tab or app, and say so when you come back.',
    get: () => bgPause, set: (v) => { bgPause = v; remember(BGPAUSE_KEY, v); },
  },
  ...(coarse ? [] : [{
    id: 'zoomcursor', section: 'Interface', label: 'Zoom to the cursor', help: 'The mouse wheel zooms toward what is under the pointer. Off: toward the middle of the screen.',
    get: () => zoomToCursor, set: (v: boolean) => { zoomToCursor = v; remember(CURSOR_KEY, v); },
  }, {
    id: 'edgescroll', section: 'Interface', label: 'Edge scrolling', help: 'Move the mouse to the edge of the screen to pan.',
    get: () => edgeScroll, set: (v: boolean) => { edgeScroll = v; remember(EDGE_KEY, v); },
  }]),
  {
    id: 'stats', section: 'Interface', label: 'Performance stats', help: 'View, altitude, frame rate and draw calls, top right.',
    get: () => statsOn, set: (v) => { statsOn = v; document.body.classList.toggle('stats', v); remember(STATS_KEY, v); },
  },
  {
    id: 'awake', section: 'Interface', label: 'Keep screen on', help: 'Stop the screen dimming and locking while the game is open, as when watching a video.',
    get: () => canWake && keepAwake, set: (v) => { keepAwake = v; remember(AWAKE_KEY, v); void syncWakeLock(); },
    locked: () => (canWake ? null : 'Not in this browser'),
  },
];
const showOptions = (onClose?: () => void, extra: OptionRow[] = [...soundToggles, ...interfaceToggles]) => openOptions([...extra, ...graphicsToggles], () => audio.play('tap'), onClose);

// ---------- performance report (src/perf-report.ts): menu → Performance report ----------
const perf = new PerfReport({
  renderer,
  toggles: () => [...interfaceToggles, ...graphicsToggles].filter((r): r is Toggle => (r as { kind?: string }).kind !== 'slider'),
  bench: ['glow', 'ao', 'sunshadows', 'reflect', 'mist', 'shadows', 'clouds', 'marks', 'weather', 'dust', 'water', 'lights', 'print', 'grade', 'flare'],
  facts: () => ({
    Version: VERSION,
    Mode: rts ? 'skirmish' : skirmish ? 'battle (?mode=skirmish)' : 'campaign',
    Region: regionDef?.name ?? '?',
    'Camera distance': cam.dist.toFixed(0),
    'Render scale': `${res.scale.toFixed(2)} (most ${dprMax.toFixed(2)})`,
    'Anti-aliasing in use': post.aaInUse,
    'Units / buildings': `${sim.cur?.units.length ?? 0} / ${sim.cur?.buildings.length ?? 0}`,
    Speed: speed,
  }),
  camDist: () => cam.dist,
  resScale: () => res.scale,
  holdRes: (on) => { res.hold = on; },
  speed: () => speed,
  setSpeed: (n) => setSpeed(n),
  open: openInfo,
  tap: () => audio.play('tap'),
  // ?perfframes=W,M: fewer frames per benchmark step (tests)
  frames: params.has('perfframes') ? { warm: Number(params.get('perfframes')!.split(',')[0]) || 5, measure: Number(params.get('perfframes')!.split(',')[1]) || 10 } : undefined,
});

// ---------- game menu (☰ Menu / Esc): pauses while open ----------
let menuOpen = false;
function openGameMenu() {
  if (menuOpen || panelOpen() || skirmish || title) return;
  menuOpen = true;
  const was = speed;
  setSpeed(0);
  // buttons that open something over the menu (and mostly come back to it): the game stays paused.
  // The menu closes before running a button, so the close handler checks which one was picked.
  const kept = new Set<() => void>();
  const keep = (fn: () => void) => { const run = () => { menuOpen = false; fn(); }; kept.add(run); return run; };
  const back = (picked: { run(): void } | null) => { if (picked && kept.has(picked.run)) return; menuOpen = false; if (speed === 0) setSpeed(was || 1); };
  const reopen = () => openGameMenu();
  // the menu's buttons close it first; ones that come back to it (Options, What's new) keep the game paused
  const toTitle = () => { const u = new URL(location.href); for (const k of [...u.searchParams.keys()]) if (k !== 'look' && k !== 'sw') u.searchParams.delete(k); location.href = u.toString(); };
  const setup = keep(() => showSkirmishSetup(() => { menuOpen = false; reopen(); }));
  const { el } = openMenu('Menu', rts ? [
    { id: 'resume', label: 'Resume', sub: 'Back to the game (Esc)', run: () => {} },
    { id: 'options', label: 'Options', sub: 'Sound, interface and graphics', run: keep(() => showOptions(() => { menuOpen = false; reopen(); })) },
    { id: 'controls', label: 'Controls', sub: 'Every key and gesture (?)', run: keep(() => showControls(() => { menuOpen = false; reopen(); })) },
    { id: 'perf', label: 'Performance report', sub: 'Measure how the game runs on this device, to send in', run: keep(() => perf.open(() => { menuOpen = false; reopen(); }, () => { if (speed === 0) setSpeed(was || 1); })) },
    { id: 'guide', label: 'Field Guide', sub: 'How the game works, page by page', run: keep(() => openGuide({ onClose: () => { menuOpen = false; reopen(); } })) },
    { id: 'rematch', label: 'Rematch', sub: 'The same map and players, from the start', confirm: 'This game will be lost · tap again', run: () => restartGame() },
    { id: 'skirmish', label: 'New skirmish', sub: 'Pick another map and players', run: setup },
    { id: 'surrender', label: 'Surrender', sub: 'Give up this game', confirm: 'Your Command Core will fall · tap again', run: () => sim.command({ type: 'surrender' }) },
    { id: 'news', label: "What's new", sub: `Version ${VERSION}`, run: keep(() => openWhatsNew(() => { menuOpen = false; reopen(); })) },
    { id: 'title', label: 'Title screen', sub: 'Leave this skirmish', confirm: 'This game will be lost · tap again', run: keep(toTitle) },
  ] : [
    { id: 'resume', label: 'Resume', sub: 'Back to the game (Esc)', run: () => {} },
    { id: 'save', label: 'Save', sub: 'To this browser (the game also autosaves)', run: () => void saveGame() },
    { id: 'load', label: 'Load', sub: 'Your last Save', run: () => void loadGame() },
    { id: 'options', label: 'Options', sub: 'Sound, interface and graphics', run: keep(() => showOptions(() => { menuOpen = false; reopen(); })) },
    { id: 'controls', label: 'Controls', sub: 'Every key and gesture (?)', run: keep(() => showControls(() => { menuOpen = false; reopen(); })) },
    { id: 'perf', label: 'Performance report', sub: 'Measure how the game runs on this device, to send in', run: keep(() => perf.open(() => { menuOpen = false; reopen(); }, () => { if (speed === 0) setSpeed(was || 1); })) },
    {
      id: 'guide', label: 'Field Guide', sub: 'How the game works, page by page · Show me around',
      // back to the menu, unless it closed to point at the HUD or start the tour: then the game carries on
      run: keep(() => openGuide({ inGame: true, onClose: (why) => { menuOpen = false; if (why === 'closed') reopen(); else if (speed === 0) setSpeed(was || 1); } })),
    },
    ...(autopilot ? [{
      id: 'autopilot', label: autopilot.on ? 'Autopilot: on' : 'Autopilot',
      sub: autopilot.on ? 'Stop it and take over (the computer has been playing)' : 'Watch it play: the computer plays your campaign (your colony) until you stop it',
      run: () => autopilot.set(!autopilot.on),
    }] : []),
    { id: 'chronicle', label: 'Chronicle', sub: 'The colony\'s story so far: moments, blocs, the family tree, the memorial', run: keep(() => void showChronicle(() => { menuOpen = false; reopen(); })) },
    { id: 'news', label: "What's new", sub: `Version ${VERSION}`, run: keep(() => openWhatsNew(() => { menuOpen = false; reopen(); })) },
    { id: 'skirmish', label: 'Skirmish', sub: 'Set up a battle against the computer (your colony is autosaved)', run: keep(() => { sim.flush(); showSkirmishSetup(() => { menuOpen = false; reopen(); }); }) },
    { id: 'title', label: 'Title screen', sub: 'Your colony is autosaved', run: keep(() => { sim.flush(); saveCamera(); toTitle(); }) },
    { id: 'new', label: 'New game', sub: scratch ? 'Start over in this region' : 'Start the campaign over', confirm: scratch ? 'Your current colony will be lost (unless you Saved it) · tap again' : 'Every region\'s colony will be lost (unless you Saved it) · tap again', run: () => restartGame() },
  ], `v${VERSION} · M1`, () => audio.play('tap'), back);
  el.querySelector('.op-foot')?.classList.add('dim');
}
$('b-menu').onclick = () => openGameMenu();

// ---------- the Chronicle (src/chronicle.ts) ----------
/** The colony's history from a fresh copy of the sim's state. */
async function showChronicle(onClose?: () => void) {
  const st = await sim.save();
  openChronicle(chronicleModel(st, { region: regionDef.name, solSeconds: content.colony.solSeconds, lineages: content.people.lineages }), content.colony.solSeconds, { tap: () => audio.play('tap'), onClose });
}
$('over-chronicle').onclick = () => { audio.play('tap'); void showChronicle(); };

// Esc opens the menu when there's nothing else for it to do (no selection, not placing, no panel open)
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat || cine || title || panelOpen() || tourActive() || document.getElementById('whatsnew') || document.getElementById('chronicle')) return;
  if (ui.sel || ui.build || document.querySelector('#build-menu.open')) return;
  e.preventDefault();
  openGameMenu();
}, true);
// a soft tick for HUD buttons
hudEl.addEventListener('pointerdown', (e) => { if ((e.target as Element).closest?.('button')) audio.play('tap'); });
/** World sounds: quieter away from the camera focus and when zoomed out; panned by screen x. */
const sndV = new THREE.Vector3();
const spatial: Spatial = (x, z) => {
  if (cam.a > 0.4) return null; // up in orbit: nothing
  const d = Math.hypot(x - cam.fx, z - cam.fz);
  const reach = 30 + cam.dist * 0.9;
  let gain = Math.min(1, 120 / (cam.dist + 45)) / (1 + 2 * (d / reach) ** 2);
  sndV.copy(regionToWorld(x, z, 1)).project(camera);
  if (sndV.z > 1 || Math.abs(sndV.x) > 1.15 || Math.abs(sndV.y) > 1.15) gain *= 0.35; // off screen
  return { gain, pan: Math.max(-0.8, Math.min(0.8, sndV.x * 0.75)) };
};

// ---------- title screen ----------
/** The title's DAILY PLANET: today's world, or today's result once played (with Share, and practice). */
function dailyChoice() {
  const d = dailyRules(dailyDate(), oceanWorld), rec = dailyRecord(d.date);
  const base = import.meta.env.BASE_URL;
  const what = `${worldName(d.world)} · ${d.players - 1} rival${d.players > 2 ? 's' : ''}${d.ai === 'hard' ? ' · Hard' : ''}`;
  const sub = rec?.result ? `Today: ${rec.result.won ? 'victory' : 'fell'} · ${rec.result.score.toLocaleString('en')} pts · share`
    : rec ? `Today's try left unfinished · practice`
    : `#${d.day} · ${what} · one try a day`;
  return {
    id: 'daily', label: 'DAILY PLANET', sub,
    run: () => {
      if (!rec) { location.href = dailyLink(d, base); return; }
      const body = rec.result ? resultHtml(d, rec.result, worldName(d.world)) : '<div class="dl-note">Today\'s scored try was started but not finished. A new planet comes at midnight UTC.</div>';
      openInfo('Daily Planet', `<div id="dl-card">${body}<div class="dl-note">${dailyStreak(d.date) > 1 ? `${dailyStreak(d.date)} days in a row · ` : ''}A new planet at midnight UTC.</div><button class="dl-practice">Practice today's planet (not scored)</button></div>`);
      const card = document.getElementById('dl-card');
      if (card && rec.result) wireShare(card, d, rec.result);
      card?.querySelector<HTMLButtonElement>('.dl-practice')?.addEventListener('click', () => { location.href = dailyLink(d, base, true); });
    },
  };
}
function showTitle() {
  // Touchdown first, then the rest by name
  // which world each region is on: Home first, then the others by name
  const bodyOf = (id: string) => { const b = content.regions[id]?.body; return b && content.bodies[b] ? b : 'home'; };
  const bodyName = (id: string) => (content.bodies[bodyOf(id)]?.name ?? 'Home').replace(/\b[A-Z]{2,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  const bodyRank = (id: string) => (bodyOf(id) === 'home' ? '' : bodyName(id));
  const regions = Object.keys(content.regions).sort((a, b) => (a === 'touchdown' ? -1 : b === 'touchdown' ? 1 : bodyRank(a).localeCompare(bodyRank(b)) || regionLabel(a).localeCompare(regionLabel(b))));
  const go = (fn: () => void) => () => { void title?.hide().then(() => { title = null; }); fn(); };
  // the title screen's Options also holds where to land and the sound
  // choosing a region only marks it; NEW GAME loads it and lands there (no reload just for picking)
  let landIn = expedition ? HOME_REGION : regionId;
  const newSub = () => (regions.length > 1 ? `Land in ${regionLabel(landIn)}` : 'Land the probe on a fresh world');
  // a trip under way with nothing saved there yet: CONTINUE lands the expedition
  const trip = !resumed && !elsewhere && !!freshShared && campaign?.current === regionId && regionId !== HOME_REGION;
  /** Options → Autopilot: watch the computer play the campaign (it continues yours, or starts one). */
  const watch = () => {
    document.getElementById('options')?.remove();
    autopilot!.set(true);
    if (resumed) go(startResume)();
    else if (elsewhere) goRegion(savedRegion, { title: '0' });
    else if (trip) go(() => sim.command({ type: 'landing', stage: 'deploy' }))();
    else if (landIn !== regionId) goRegion(landIn, { land: '1' });
    else { if (!scratch) void wipeCampaign(); if (freshShared) sim.newGame(Date.now() % 100000); go(startLanding)(); }
  };
  const AP = 'Autopilot: the computer plays your campaign';
  const pick = (id: string, label: string, help: string, get: () => boolean, set: () => void): Toggle => ({ id, section: AP, label, help, get, set, state: (on) => (on ? '●' : '') });
  const apRows: OptionRow[] = autopilot ? [
    { id: 'ap:watch', section: AP, label: 'Watch the computer play', help: `${resumed || elsewhere || trip ? 'Continues your campaign (your colony)' : 'Starts a new campaign'}: it builds, answers the story and travels while you watch · Stop on its badge hands it back`, get: () => false, set: watch, state: () => 'START ▸' },
    ...(['first', 'honest', 'random', 'last'] as ChoicePolicy[]).map((p) => pick(`ap:policy:${p}`, `Answers: ${p === 'first' ? 'the first choice' : p === 'honest' ? 'the honest one' : p === 'random' ? 'at random' : 'the last choice'}`, POLICIES[p], () => autopilot.prefs.policy === p, () => { autopilot.prefs.policy = p; autopilot.save(); })),
    { id: 'ap:assist', section: AP, label: 'Assist when stuck', help: `Finish an objective with no progress for ${autopilot.prefs.assistMinutes} min, and send away a pack about to take the Command Core (logged in violet)`, get: () => autopilot.prefs.assist, set: (v: boolean) => { autopilot.prefs.assist = v; autopilot.save(); } },
    ...[1, 2, 3].map((n) => pick(`ap:speed:${n}`, `Speed ×${n}`, n === 1 ? 'Real time' : `${n} times as fast (also on its badge)`, () => autopilot.prefs.speed === n, () => { autopilot.prefs.speed = n; autopilot.save(); })),
  ] : [];
  const titleOptions: OptionRow[] = [
    ...apRows,
    ...soundToggles,
    ...(regions.length > 1 ? regions.map((id): Toggle => ({
      id: `region:${id}`, section: 'Region: where New Game lands', label: regionLabel(id), help: bodyName(id),
      get: () => id === landIn, set: () => { landIn = id; title?.setSub('new', newSub()); }, state: (on) => (on ? 'HERE' : ''),
    })) : []),
  ];
  const here = regionId === HOME_REGION ? 'Your colony' : `${regionLabel(regionId)}`;
  const saved = !!(resumed || elsewhere || trip);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const choices: TitleChoice[] = [
    ...(resumed ? [{ id: 'continue', kind: 'hero' as const, label: 'CONTINUE', sub: `${here} · ${solTime(resumed.sim.tick)}`, run: go(startResume) }] : []),
    ...(elsewhere ? [{ id: 'continue', kind: 'hero' as const, label: 'CONTINUE', sub: `${savedRegion === HOME_REGION ? 'Your colony in ' : ''}${regionLabel(savedRegion)} · ${solTime(elsewhere.sim.tick)}`, run: () => goRegion(savedRegion) }] : []),
    ...(trip ? [{ id: 'continue', kind: 'hero' as const, label: 'CONTINUE', sub: `Your expedition to ${regionLabel(regionId)}`, run: go(() => sim.command({ type: 'landing', stage: 'deploy' })) }] : []),
    {
      // with a colony saved, starting over is the quieter button (and asks twice); without one it is the hero
      id: 'new', kind: saved ? 'plain' : 'hero', label: 'NEW GAME', sub: newSub(),
      ...((autosaved || campaign) && !scratch ? { confirm: autosaved ? `Your colony${elsewhere ? ` in ${regionLabel(savedRegion)}` : ''} at ${solTime(autosaved.sim.tick)} will be lost · tap again` : 'Your campaign will be lost · tap again' } : {}),
      run: () => {
        if (landIn !== regionId) { goRegion(landIn, { land: '1' }); return; }
        // a new campaign: every region's save goes, and the story starts again
        if (!scratch) void wipeCampaign();
        if (freshShared) sim.newGame(Date.now() % 100000);
        go(startLanding)();
      },
    },
    ...(!saved && !autosaved && !campaign ? [{ id: 'first', kind: 'link' as const, label: 'First time? Open the Field Guide ▸', run: () => openGuide() }] : []),
    { ...dailyChoice(), kind: 'tile' },
    { id: 'skirmish', kind: 'tile', label: 'SKIRMISH', sub: 'You against the computer', run: () => showSkirmishSetup() },
    { id: 'guide', kind: 'icon', icon: '📖', label: 'Guide', sub: 'Field Guide: how to play, page by page', run: () => openGuide() },
    { id: 'options', kind: 'icon', icon: '⚙', label: 'Options', sub: regions.length > 1 ? 'Region, sound, graphics and the autopilot' : 'Sound, graphics and the autopilot', run: () => showOptions(undefined, titleOptions) },
    { id: 'tour', kind: 'icon', icon: '🪐', label: 'Tour', sub: 'Fly round the system with the menu put away · tap to come back', run: () => title?.tour(true) },
    ...(autopilot ? [{ id: 'watch', kind: 'icon' as const, icon: '👁', label: 'Watch', sub: `Watch the computer play${saved ? ' your campaign' : ''} (settings in Options)`, run: watch }] : []),
    { id: 'news', kind: 'icon', icon: '✦', label: "What's new", sub: `Version ${VERSION}`, badge: hasUnseen(), run: () => openWhatsNew(() => title?.root.querySelectorAll('.badge').forEach((b) => b.remove())) },
    ...(!coarse ? [{ id: 'editor', kind: 'icon' as const, icon: '✎', label: 'Editor', sub: 'Units, buildings, maps and models', href: `${import.meta.env.BASE_URL}editor.html` }] : []),
  ];
  title = new TitleScreen(cam, camera, {
    system,
    choices,
    foot: `<button class="t-ver" title="What's new">v${VERSION}</button> · M1 · <a href="https://deeek.org/">deeek.org</a>`,
    tap: () => audio.play('tap'),
    // browsers hold sound back until a tap or key (unless they allow autoplay): say so, until it runs
    endings: (() => { const n = endingsReached().length; return n ? `ENDINGS: ${n} OF ${ENDINGS.length}` : ''; })(),
    status: () => (audio.disabled || !audio.on || audio.state === 'running' ? '' : `♪ ${matchMedia('(pointer: coarse)').matches ? 'TAP' : 'CLICK'} ANYWHERE FOR SOUND`),
  });
  if (params.get('tour') === '1') title.tour(true);
  const ver = title.root.querySelector<HTMLButtonElement>('.t-ver')!;
  ver.onclick = () => { audio.play('tap'); openWhatsNew(() => title?.root.querySelectorAll('.badge').forEach((b) => b.remove())); };
}

// ground shadows (in the light map): each building kind's body radius and a rough height
const shadowSun = new THREE.Vector3();
const shaftSun = new THREE.Vector3(), shaftDir = new THREE.Vector3(), shaftUv = new THREE.Vector2();
const sightTo = new THREE.Vector3(), sightOc = new THREE.Vector3();
/** 1 when nothing big and round stands between the camera and the sun, 0 when a planet or moon hides it. */
function sunInSight(): number {
  const cp = camera.position;
  const dist = sightTo.subVectors(system.sunPos, cp).length();
  sightTo.divideScalar(dist);
  for (const o of system.occluders(R)) {
    sightOc.subVectors(o.pos, cp);
    const along = sightOc.dot(sightTo);
    if (along <= 0 || along > dist) continue;
    if (sightOc.lengthSq() - along * along < o.radius * o.radius) return 0;
  }
  return 1;
}
const movers: Mover[] = [];
const heat: THREE.Vector3[] = [], heatW = new THREE.Vector3();
/** Buildings that run hot: the air shimmers above them while they're powered. */
const HOT_ROLES = new Set(['core', 'reactor', 'generator', 'geothermal', 'factory', 'printer', 'deepmine']);
let lastCamDist = 0, zoomRate = 0;
const shadowSizes = Object.fromEntries(Object.entries(content.buildings).map(([k, d]) => {
  const r = Math.max(1, (d.clearance ?? 8) / 2 * 0.85);
  return [k, { r, h: d.role === 'wall' || d.role === 'gate' ? 3 : Math.min(r * 1.2, 9) }];
}));
region.shadowSize = (k) => shadowSizes[k];
/** What each unit type leaves on the ground: tread marks (vehicles), footprints (creatures), or nothing (hover, sea, air). */
const MARK_KIND = UNIT_DEFS.map((d) => (d.move ? -1 : content.units[d.id]?.faction === 'fauna' ? 1 : 0));
const markMovers: MarkMover[] = [];
/** This world's colour grade (src/world/post.ts). */
const worldGrade = gradeFor(airGlow ? bodyDef?.sky ?? '#8fb0ad' : undefined, (bodyDef?.ground ?? []).map((g) => g.color), bodyDef ? !!bodyDef.ocean : true);
let vignetteCss = false;
// ---------- sounds of the place ----------
/** How much of the ground round the camera focus is water (0..1), and how close the camera is: sampled twice a second. */
let waterNear = 0, waterIn = 0;
function placeSounds(dt: number) {
  const c = sim.cur;
  const playing = !skirmish && !title && !cine && !!c?.deployed;
  // in orbit (no world sounds) the surf goes at once, not at the next sample
  if (!spatial(cam.fx, cam.fz)) waterNear = 0;
  else if (playing && (waterIn -= dt) <= 0) {
    waterIn = 0.5;
    const near = spatial(cam.fx, cam.fz)?.gain ?? 0, r = 18 + cam.dist * 0.35;
    let wet = 0, n = 0;
    for (const [k, rr] of [[12, r], [6, r / 2], [1, 0]] as const) for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      if (regionHeightRaw(cam.fx + Math.cos(a) * rr, cam.fz + Math.sin(a) * rr) < 0.3) wet++;
      n++;
    }
    // a little water is heard (a lake's edge), half or more is a full shore
    waterNear = near * Math.min(1, Math.sqrt(wet / n) * 1.5);
  }
  audio.beds({
    water: playing ? waterNear : 0,
    sites: playing ? c!.drones.filter((d) => d.working).map((d) => ({ x: d.tx, z: d.tz })) : [],
    fauna: playing ? c!.fauna : undefined,
    camps: playing ? (c!.camps ?? []).filter((cp) => cp.met && !cp.gone) : [],
    dt, spatial,
  });
}

// ---------- frame loop ----------
// the body's sky: Home's by default; airless bodies have a black one, day and night
const skyDay = new THREE.Color(bodyDef?.sky ?? (airGlow ? '#8fb0ad' : '#05070b'));
const skyNight = new THREE.Color(airGlow ? '#0b1622' : '#020306');
const skySunset = new THREE.Color('#c9825e');
const tintTmp = new THREE.Color();
const space = new THREE.Color('#020306');
const bg = new THREE.Color();
const shadowDir = new THREE.Vector3();
/** The sky the reflections are baked from, and the ground under it (sunlit dust). */
const envLook: SkyLook = { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Vector3(), sunColor: new THREE.Color(), up: new THREE.Vector3() };
const envGround = new THREE.Color(terrain.world?.ground[0] ?? '#7c4a33');
// the colony's vehicles wear the dust of the ground they drive on (src/world/wear.ts)
wearUniforms.uWearDust.value.copy(envGround);
/** How strongly the sky lights and reflects; the sky fill dims by part of it so the scene isn't brighter overall. */
const ENV_STRENGTH = 0.65;
/** …and for the ground. */
const GROUND_ENV = 0.2;
const t0 = performance.now();
let last = t0;
let ready = false;
let gameT = 0;

function frame(now: number) {
  perf.frameStart(now);
  adaptRes((now - last) / 1000);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = (now - t0) / 1000;

  const simSecs = sim.cur && !skirmish ? sim.cur.secs + sim.alpha(now) * (speed / TICK_HZ) : undefined;
  // skirmish holds a fixed day or night (its ☀/☾ button): the sim clock at that hour
  const sol = content.colony.solSeconds;
  // a cinematic with an hour: the sky at that time of day on this sol while it plays (the game's own after)
  const cineHour = cine?.def.hour;
  const sunSecs = skirmish ? ((skirmish.hour - START_HOUR) / 24) * sol
    : cineHour !== undefined && simSecs !== undefined ? Math.floor(simSecs / sol) * sol + ((((cineHour - START_HOUR) % 24) + 24) % 24 / 24) * sol : simSecs;
  {
    // how bright the sky is round the camera (hides the Milky Way and most stars by day)
    const up = system.sunPos.clone().normalize().dot(U);
    const inAir = airGlow ? 1 - smoothstep(90, 420, Math.max(cam.dist, cam.altitude() * 0.8)) : 0;
    system.skyDay = smoothstep(-0.15, 0.25, up) * inAir;
    system.skyAir = inAir;
    // sunrise and sunset: the sun within a few degrees of the horizon
    system.golden = smoothstep(-0.22, -0.02, up) * (1 - smoothstep(0.06, 0.32, up));
    system.skyUp.copy(U);
    system.pixelRatio = renderer.getPixelRatio();
  }
  system.update(t + 200, camera, cam.b, 1 - cam.a, innerWidth, viewH(), sunSecs === undefined ? undefined : sunAngle(sunSecs, sol, U.x, U.z));
  cam.update(dt, system.starPos);
  (atmosphere.material as THREE.ShaderMaterial).uniforms.strength.value = airStrength * smoothstep(300, 1400, cam.altitude());
  atmosphere.visible = !!airGlow && cam.altitude() > 300;
  provinces.update(camera, cam.dist, innerWidth, viewH());
  if (surfaceOn) { updateSurface(dt, system.sunPos, cam.altitude(), t); if (cloudy) updateClouds(clouds, cam.altitude()); }
  if (title) provinces.hide(); // a clean planet behind the title, no map overlay

  // sky: day/night at the landing site, fading to space as we climb
  const sunUp = system.sunPos.clone().normalize().dot(U);
  bg.copy(skyNight).lerp(skyDay, smoothstep(-0.15, 0.25, sunUp));
  // a warmer sky (and fog) round sunrise and sunset
  if (airGlow) bg.lerp(skySunset, system.golden * 0.4);
  // cam.dist alone undercounts during the landing chase (close to the probe, high above the ground)
  const air = 1 - smoothstep(90, 420, Math.max(cam.dist, cam.altitude() * 0.8));
  // weather: a greyer (rain) or tawny (dust) sky, darker, the haze pulled in
  weather.update(simSecs ?? gameT, t, cam.focus, U, E, N, air, cam.dist);
  const wl = weather.look;
  if (airGlow && wl.tintK > 0) bg.lerp(tintTmp.copy(wl.tint).multiplyScalar(0.35 + 0.65 * smoothstep(-0.15, 0.25, sunUp)), wl.tintK).multiplyScalar(1 - wl.dark * 0.4);
  system.overcast = weather.amount * air;
  scene.background = bg.clone().lerp(space, 1 - air);
  updateWater(skirmish ? t : gameT, bg);
  fog.color.copy(bg);
  // the sky for reflections: as seen from the ground (it fades out climbing to orbit, where there's no sky round you)
  if (skyEnv.enabled) {
    const day = smoothstep(-0.15, 0.25, sunUp);
    envLook.horizon.copy(bg).multiplyScalar(1.1);
    envLook.zenith.copy(bg).multiplyScalar(0.7);
    envLook.ground.copy(envGround).multiplyScalar(0.12 + 0.88 * day);
    envLook.sun.copy(system.sunPos).normalize();
    envLook.sunColor.copy(system.sunColor).multiplyScalar(smoothstep(-0.05, 0.08, sunUp) * (1 - system.overcast * 0.85));
    envLook.up.copy(U);
    skyEnv.update(envLook, t);
    skyEnv.intensity = ENV_STRENGTH * air;
  }
  // mist and sun haze (they ride the fog: none without air, none from orbit)
  {
    const au = atmosUniforms, on = mistOn && !!airGlow ? air : 0;
    mistLevels ??= regionMistLevels();
    au.uAtR.value = R;
    au.uAtBase.value = mistLevels.base;
    au.uAtScale.value = mistLevels.scale;
    au.uAtReach.value = cam.dist;
    // morning and evening mist, a little by day, more in weather
    au.uAtMist.value = on * Math.min(0.9, 0.38 + 0.45 * system.golden + 0.35 * wl.haze);
    au.uAtSun.value.copy(system.sunPos).normalize();
    au.uAtSunCol.value.copy(system.sunColor).lerp(skySunset, 0.35 + 0.4 * system.golden);
    au.uAtSunK.value = on * smoothstep(-0.08, 0.05, sunUp) * (0.3 + 0.55 * system.golden) * (1 - system.overcast * 0.75);
  }
  // the ground takes much less of it than metal: keeps its hills' shading
  skyEnv.own(region.patch.material, GROUND_ENV * air);
  skyEnv.own(globe.material, GROUND_ENV * air);
  fog.near = air > 0.01 ? cam.dist * 2.2 * (1 - wl.haze * 0.7) : 1e9;
  fog.far = air > 0.01 ? lerp(cam.dist * 9, cam.dist * 60, 1 - air) * (1 - wl.haze * 0.6) : 1e9 + 1;

  if (skirmish) {
    region.updateOverlay(cam.dist, t);
    skirmish.update(now, dt);
    if (!ready && skirmish.ready) { ready = true; exo.ready = true; reveal(); }
  } else if (sim.prev && sim.cur) {
    const day = smoothstep(-0.15, 0.25, sunUp);
    cine?.update(dt, day);
    // story cinematics the sim has queued: one at a time, once the landing and title are done
    const cq = sim.cur.story.cine ?? [];
    for (const id of cineFinished) if (!cq.includes(id)) cineFinished.delete(id);
    const queued = cq.find((id) => !cineFinished.has(id));
    if (queued && !cine && !title && sim.cur.deployed) {
      const def = preview?.cinematic?.id === queued ? preview.cinematic.def : content.cinematics[queued];
      // automated tests don't sit through cinematics unless they asked for one
      if (!def || def.scene === 'landing' || (navigator.webdriver && !fireCine)) sim.command({ type: 'cinematic', id: queued, done: true });
      else playCinematic(queued, def, queued === fireCine ? Number(params.get('cine')) || 0 : 0);
    }
    region.flora?.update(t, 1 - smoothstep(-0.2, 0.15, sunUp), camera);
    if (selectFirstDrone && !cine && sim.cur.deployed && sim.cur.drones.length) {
      selectFirstDrone = false;
      // (not while the computer plays: nothing of yours to select)
      if (!autopilot?.on) {
      ui.sel = { kind: 'drone', id: sim.cur.drones[0].id };
      hud.selected();
      }
    }
    if (title) title.update(dt, cam.altitude(), solTime(sim.cur.tick).toUpperCase());
    const alpha = sim.alpha(now);
    // world animations run on game time: frozen when paused, faster at ×3
    gameT += dt * speed;
    region.update(sim.prev, sim.cur, alpha, t, ui, cam.dist, camera, gameT);
    climax?.update(sim.cur, dt, gameT);
    // fog shows once the landing has handed over (the descent keeps its vista)
    fogView.amount = (cine && !cine.world) || title ? 0 : 1;
    fogView.update(sim.cur.fog, dt);
    if (sim.cur.players) army?.setTeamColors(sim.cur.players.map((p) => p.color));
    else if (sim.cur.factions) army?.setTeamColors(factionColors(sim.cur.factions));
    army?.update(asArmy(sim.prev), asArmy(sim.cur), alpha, syncArmySel(), dt, cam.dist);
    colonists?.update(sim.prev, sim.cur, alpha, ui.sel?.kind === 'colonist' ? ui.sel.id : null, gameT);
    natives?.update(sim.prev, sim.cur, alpha, gameT, cam.dist);
    if ((fireStory || startMission || fireCine || preview?.setup) && sim.cur.deployed && !storyFired) {
      storyFired = true;
      sim.command({ type: 'debug', setup: preview?.setup, story: fireStory ?? undefined, mission: startMission ?? undefined, cinematic: fireCine ?? undefined });
    }
    // sound: only the wind (and the cinematic's own cues) during a cinematic
    audio.quiet = !!cine || !!title;
    // music: the title's, then the director's in play (not over cinematics or the landing)
    audio.musicFor(title?.active ? 'title' : !title && !cine && sim.cur.deployed ? 'play' : null, sim.cur.daylight, dt);
    audio.worldFx(sim.cur.fx, sim.cur.tick, cam.fx, cam.fz, spatial);
    audio.ambient(sim.cur.daylight, air, dt);
    placeSounds(dt);
    sim.seenTick = sim.cur.tick;
    if (!ready) { ready = true; exo.ready = true; reveal(); }
  }
  if (lights) {
    // darker nights so the lights read (only while they're on); steady lights fade out by day
    const night = lights.enabled ? 1 - smoothstep(-0.2, 0.15, sunUp) : 0;
    lights.night = night;
    system.fill.intensity = lerp(0.7, 0.32, night) * (1 - system.overcast * 0.3) * (skyEnv.enabled ? 1 - 0.45 * air : 1);
    system.ambient.intensity = lerp(0.12, 0.07, night);
    const c = sim.cur, p = sim.prev;
    const live = !skirmish && c && p && c.deployed;
    const alpha = live ? sim.alpha(now) : 0;
    const core = live ? c.buildings.find((b) => b.kind === 'core') : undefined;
    lights.update(renderer, camera, dt, t, {
      buildings: live ? c.buildings : undefined,
      core: core && region.core.visible ? { x: core.x, z: core.z, beacon: Math.max(0, Math.sin(t * 4)) } : null,
      sun: shadowSun.copy(system.sunPos).normalize(),
      sizes: shadowSizes,
      scars: live ? c.planet?.scars : undefined,
      drones: live ? c.drones.map((b) => {
        const a = p.drones.find((d) => d.id === b.id) ?? b;
        let dh = b.heading - a.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        return { x: lerp(a.x, b.x, alpha), z: lerp(a.z, b.z, alpha), heading: a.heading + dh * alpha };
      }) : undefined,
    });
  }
  updateHud(dt, now);
  updateGuide(now);
  autopilot?.update(now, dt);
  input?.update(dt, !title && !cine && !menuOpen && !panelOpen() && !document.getElementById('whatsnew'));
  document.body.classList.toggle('paused', userPaused && speed === 0 && !menuOpen && !cine && !title);
  // dust behind movers (frozen while paused), heat over working machines, blur on fast zooms
  const day = smoothstep(-0.15, 0.25, sunUp);
  {
    const live = !skirmish && sim.cur?.deployed && !title;
    movers.length = 0;
    if (live && dust.enabled && cam.dist < 400) {
      for (const [id, d] of region.drones) movers.push({ id: 'd' + id, x: d.x, z: d.z, lift: d.lift ?? 0 });
      if (army) for (let s = 0; s < army.visible.length; s++) if (army.visible[s]) movers.push({ id: 'u' + s, x: army.lx[s], z: army.lz[s], lift: army.lift[s] });
    }
    dust.update(dt * Math.min(1, speed), movers, day, viewH() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  }
  // the ground weathers: cloud shadows, wet after rain, tracks; smoke from damaged buildings; ruins (src/world/ground.ts, ruins.ts)
  {
    const gdt = skirmish ? dt : dt * speed;
    groundSky.update(gdt, airGlow ? air : 0, day, weather.kind === 'rain' ? weather.amount : 0, system.overcast, bg);
    const c = sim.cur;
    const live = !skirmish && !title && !!c?.deployed;
    markMovers.length = 0;
    if (marks?.enabled && live && army) {
      for (let s = 0; s < army.slots; s++) {
        const k = MARK_KIND[army.type[s]];
        if (!army.visible[s] || k < 0 || army.lift[s] > 0.5) continue;
        const d = UNIT_DEFS[army.type[s]];
        markMovers.push({ key: s, x: army.lx[s], z: army.lz[s], w: Math.max(0.6, d.radius * (d.scale ?? 1) * 0.85), kind: k as 0 | 1 });
      }
    }
    marks?.update(renderer, live ? gdt : 0, markMovers, (x, z) => regionHeightRaw(x, z) < 0.3);
    if (army && live && c) {
      if (gdt > 0) {
        for (const b of c.buildings) {
          if (b.progress < 1 || (b.team && c.players && !b.seen)) continue;
          const max = content.buildings[b.kind]?.hp ?? 0;
          const f = max > 0 ? b.hp / max : 1;
          if (f >= 0.6) continue;
          const sz = shadowSizes[b.kind] ?? { r: 3, h: 4 };
          army.fx.smoulder(b.x, b.z, b.kind === 'core' ? 14 : sz.h, sz.r, (0.6 - f) / 0.6, gdt);
        }
        for (const h of region.ruins.smouldering()) army.fx.smoulder(h.x, h.z, 1.5, h.r, h.k * 0.7, gdt);
      }
      for (const f of region.ruins.fresh) { army.fx.collapse(f.x, f.z, f.r, f.h); marks?.scorch(f.x, f.z, f.r * 1.4, 0.85); }
    }
    region.ruins.fresh.length = 0;
    // with no grade pass running, the page draws the vignette
    const css = post.grading && !post.gradeInUse;
    if (css !== vignetteCss) { vignetteCss = css; document.body.classList.toggle('vignette', css); }
  }
  heat.length = 0;
  if (!skirmish && dust.enabled && post.enabled && sim.cur?.deployed && cam.dist < 260) {
    const tanF = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const found: { d: number; v: THREE.Vector3 }[] = [];
    for (const b of sim.cur.buildings) {
      const role = content.buildings[b.kind]?.role;
      if (!role || !HOT_ROLES.has(role) || b.progress < 1 || !b.powered) continue;
      const sz = shadowSizes[b.kind] ?? { r: 3, h: 4 };
      const w = regionToWorld(b.x, b.z, sz.h * 0.9, heatW);
      const dist = w.distanceTo(camera.position);
      const p = w.project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue;
      found.push({ d: dist, v: new THREE.Vector3((p.x + 1) / 2, (p.y + 1) / 2, (sz.r * 1.1) / (dist * tanF * 2)) });
    }
    found.sort((a, b) => a.d - b.d);
    for (const f of found.slice(0, HEAT_MAX)) heat.push(f.v);
  }
  // how fast the camera is zooming (log distance per second), eased
  const zr = dt > 0 && lastCamDist > 0 ? Math.abs(Math.log(cam.dist / lastCamDist)) / dt : 0;
  lastCamDist = cam.dist;
  zoomRate += (zr - zoomRate) * (1 - Math.exp(-dt * 10));
  {
    // sun shafts: strongest in the air with the sun low; fade as the sun leaves the screen or goes behind the camera
    const sp = shaftSun.copy(system.sunPos).project(camera);
    const ahead = sp.z < 1 && system.sunPos.clone().sub(camera.position).dot(camera.getWorldDirection(shaftDir)) > 0;
    const onScreen = ahead ? 1 - smoothstep(1.0, 1.6, Math.max(Math.abs(sp.x), Math.abs(sp.y))) : 0;
    // only while the sun is really in view: above the horizon down here, not behind a planet up there (at night the sun
    // under the ground still projected "ahead" of a downward camera, and every glowing building threw a shaft at it)
    const sunShows = THREE.MathUtils.lerp(sunInSight(), smoothstep(-0.02, 0.08, sunUp), air);
    const shafts = sunShows * onScreen * (0.25 + 0.75 * air) * (0.7 + 0.6 * system.golden) * (1 - system.overcast * 0.85);
    post?.update({
      night: 1 - smoothstep(-0.2, 0.15, sunUp), orbit: 1 - air, sun: shaftUv.set((sp.x + 1) / 2, (sp.y + 1) / 2), shafts,
      zoom: zoomBlur && !cine && !title ? smoothstep(1.2, 5, zoomRate) * 0.035 : 0,
      heat, heatK: 0.5 + 0.5 * day, time: t,
      grade: worldGrade, golden: system.golden, camDist: cam.dist,
    });
  }
  {
    // up close the sun hands over to the shadow-casting light; the blob shadows fade by as much
    const hk = sunShadows.update(cam.focus, shadowDir.copy(system.sunPos).normalize(), cam.dist, air, system.sunColor, system.sunIntensity, t);
    system.handoff(hk);
    lights?.realShadows(hk);
  }
  post ? post.render(dt) : renderer.render(scene, camera);
  perf.frameEnd();
  // the flare: washed out a little under a bright daytime sky
  flare.update(camera, system.sunPos, STAR_R, system.occluders(R), Math.min(1, 0.45 * air * smoothstep(-0.15, 0.25, sunUp) + system.overcast * 0.9), dt);
  flare.render(renderer);
  requestAnimationFrame(frame);
}
// compile every shader now rather than stalling on the first frame
await loadStep('Warming up shaders…');
await renderer.compileAsync(scene, camera).catch(() => {});
await loadStep('Starting the simulation…');
requestAnimationFrame(frame);

// ---------- debug / screenshot hooks ----------
const exo = {
  ready: false,
  /** The body and region size being played (test hook). */
  world: () => ({ body: bodyId, radius: R, half: HALF }),
  renderer,
  scene,
  system,
  flare,
  dust,
  weather,
  /** Cloud shadows and wet ground, and the ground marks (src/world/ground.ts). */
  groundSky,
  marks,
  cam,
  sim,
  skirmish,
  region,
  /** The landing cinematic while it plays. */
  get landing() { return cine && !cine.world ? cine : null; },
  /** Any cinematic while it plays. */
  get cinematic() { return cine; },
  /** Test hook: the hour the sky shows (a cinematic's `hour` while it plays, else the game's). */
  skyHour: () => hourAt(cine?.def.hour !== undefined ? ((cine.def.hour - START_HOUR + 24) % 24 / 24) * content.colony.solSeconds : sim.cur?.secs ?? 0, content.colony.solSeconds),
  get title() { return title; },
  /** The autopilot's view (badge, card reader, director), or null. */
  autopilot,
  /** The game's speed (0 = paused), and the Field Guide's tips (src/guide.ts). */
  get speed() { return speed; },
  guideTips: tips,
  setView: (v: ViewName, instant = true) => { if (v in VIEWS) cam.setView(v, instant); },
  hud,
  ui,
  army,
  skyEnv,
  droneScreen: (id?: number) => {
    const d = id === undefined ? null : region.drones.get(id);
    const v = (d ? d.world : region.droneWorld).clone().project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * viewH() };
  },
  /** Screen position of a combat unit (by id), or null if it isn't drawn. */
  unitScreen: (id: number) => {
    const u = sim.cur?.units.find((x) => x.id === id);
    if (!u || !army || !army.visible[u.slot]) return null;
    const v = new THREE.Vector3(army.wx[u.slot], army.wy[u.slot] + 1, army.wz[u.slot]).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * viewH() };
  },
  colonists,
  natives,
  /** Screen position of a colonist drawn outdoors (by id), or null. */
  colonistScreen: (id: number) => {
    const c = colonists?.at.get(id);
    if (!c) return null;
    const v = c.world.clone().add(new THREE.Vector3(0, 0, 0)).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * viewH() };
  },
  /** Screen position of a region point on the ground. */
  screenOf: (x: number, z: number, lift = 0) => {
    const v = regionToWorld(x, z, lift).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * viewH() };
  },
  canPlace,
  capture: () => { post ? post.render(0) : renderer.render(scene, camera); flare.render(renderer); return renderer.domElement.toDataURL('image/png'); },
  post,
  height: regionHeight,
  /** Test hook: raw ground height (below 0.3 is water to the sim). */
  heightRaw: regionHeightRaw,
  fogView,
  audio,
  res,
  surfaceUniforms,
};
(window as unknown as { __exo: typeof exo }).__exo = exo;
