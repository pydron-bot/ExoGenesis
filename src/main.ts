import { viewH } from './viewport';
import * as THREE from 'three';
import './style.css';
import { VIEWS, ZoomCamera, type ViewName } from './camera';
import { Input } from './input';
import { AUTOSAVE, delSave, getSave, putSave, type AutoSave } from './save';
import { SimClient } from './sim/client';
import { TICK_HZ, type Building, type PlaySetup, type SimState, type Snapshot } from './sim/types';
import { biomeOf } from './content/nature';
import { content, contentIssues, onContentHot, type RegionDef } from './content';
import { PREVIEW_KEY, type CameraKeyDef, type CinematicDef, type InterfaceDef, type MissionDef, type StoryDef } from './content/defs';
import { applyInterface } from './ui-theme';
import { lerp, smoothstep } from './world/noise';
import { buildAtmosphere, globeMesh, HALF, R, U, regionHeight, regionHeightRaw, regionTerrain, regionToWorld, setRegionTerrain, type GlobeArrays } from './world/planet';
import { Provinces, type ProvinceData } from './world/provinces';
import { RegionView, groundTextures } from './world/region';
import { SolarSystem } from './world/system';
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
import { enableColonyLights } from './world/lights';
import { Post } from './world/post';
import { openMenu, openOptions, panelOpen, type OptionRow, type Toggle } from './options';
import { ArmyView } from './skirmish/view';
import { ColonistView } from './world/colonists';
import { InhabitantView } from './world/inhabitants';
import { DEFS as UNIT_DEFS, type SkSnapshot } from './skirmish/types';
import { gateSnap, linePoints, placeProblem } from './sim/rules';
import { campSites } from './sim/inhabitants';
import { START_HOUR, hourAt, sunAngle } from './sim/daylight';
import type { RegionUi } from './world/region';
import { GameAudio, type Spatial } from './audio';
import { TitleScreen } from './title';
import { VERSION } from './changelog';
import { hasUnseen, openWhatsNew } from './whatsnew';
import { registerServiceWorker } from './pwa';
import { updateWater } from './world/water';
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
let autosaved: AutoSave | undefined;
if (!skirmishMode && !scratch) {
  if (params.get('new') === '1') await delSave(AUTOSAVE).catch(() => {});
  else {
    const a = await getSave<AutoSave>(AUTOSAVE).catch(() => undefined);
    if (a?.version === 2 && a.sim && !a.sim.over && a.sim.phase === 'deployed') autosaved = a;
  }
}
const savedRegion = autosaved?.sim.region ?? 'touchdown';
const askedRegion = params.get('region');
const regionId = rts ? 'skirmish' : preview ? preview.id : askedRegion && content.regions[askedRegion] ? askedRegion : content.regions[savedRegion] ? savedRegion : 'touchdown';
/** ?biome=<id> tries another biome's plants and wildlife on this region (the sim plays the region with it). */
const biomeParam = params.get('biome');
const biomeTest = !!biomeParam && !!content.biomes[biomeParam];
const regionDef: RegionDef = rts ? rts.map.region : biomeTest ? { ...(preview?.def ?? content.regions[regionId]), biome: biomeParam! } : preview?.def ?? content.regions[regionId];
const look = params.get('look') === 'smooth' ? 'smooth' : 'flat';
/** The region's terrain with its body (a planet, moon, asteroid or comet) looked up: every worker gets this. */
const terrain = regionTerrain(regionDef, content.bodies);
const bodyId = regionDef.body && content.bodies[regionDef.body] ? regionDef.body : 'home';
const bodyDef = content.bodies[bodyId];
// Start both workers first so their work overlaps everything below: the sim
// (boots its module graph and a new game) and the globe/province generator.
/** Sim events that arrive before the HUD exists wait here. */
type At = { x: number; z: number } | undefined;
const early: [string, 'info' | 'warn' | 'bad', At][] = [];
let logFn: ((text: string, level: 'info' | 'warn' | 'bad', at?: At) => void) | null = null;
// sound (colony only; ?sound=0 turns it off for good, the ⋯ menu for now)
const audio = new GameAudio(content.sound, content.assets, skirmishMode || params.get('sound') === '0', content.music);
const sim = new SimClient((t, l, cue, at) => {
  if (cue) audio.event(cue);
  if (logFn) logFn(t, l, at); else early.push([t, l, at]);
}, !skirmishMode, regionId, biomeTest || rts ? regionDef : preview?.def, preview?.story, preview?.mission, preview?.cinematic?.def.scene === 'landing' ? undefined : preview?.cinematic, rts?.setup);
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
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
// Render scale: starts at the device's (capped) pixel ratio and steps down while
// frames are slow, back up when there's headroom. Phones are fill-bound, so this
// is the big lever. ?dpr=N pins it.
const dprPinned = Number(params.get('dpr')) || 0;
const dprMax = dprPinned || Math.min(devicePixelRatio, coarse ? 1.75 : 2);
const dprMin = Math.min(dprMax, 1);
const res = { scale: dprMax, acc: 0, n: 0, good: 0 };
renderer.setPixelRatio(dprMax);
/** Called once a frame with the real frame time (unclamped, seconds). */
function adaptRes(rawDt: number) {
  if (dprPinned || rawDt > 0.5 || document.hidden) return; // a stall or a background tab, not load
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
const GLOW_KEY = 'exo.glow', SHADOWS_KEY = 'exo.shadows', PRINT_KEY = 'exo.print', WATER_KEY = 'exo.water';
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
const post = new Post(renderer, scene, camera);
post.enabled = setting(GLOW_KEY, 'bloom', !coarse && !navigator.webdriver);
if (lights) lights.shadows = setting(SHADOWS_KEY, 'shadows', true);

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
if (look === 'smooth') {
  // match the globe to the textured landing patch as seen from a distance
  const m = groundTextures().mean;
  (globe.material as THREE.MeshStandardMaterial).color.setRGB(m, m * 0.98, m * 0.96);
}
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
const heldLog: [string, 'info' | 'warn' | 'bad', At][] = [];
/** Pings the minimap (set once the HUD exists: early events come before it). */
let pingFn: ((x: number, z: number, color: string) => void) | null = null;
/** Where the latest event with a place happened (H takes the camera there). */
let lastAt: At;
const goTo = (at: { x: number; z: number }) => { cam.fx = at.x; cam.fz = at.z; if (cam.a > 0.5) cam.setView('surface'); };
function log(text: string, level: 'info' | 'warn' | 'bad' = 'info', at?: At) {
  // a cinematic hides the log; keep events for when it ends
  if (cine) { heldLog.push([text, level, at]); return; }
  const el = document.createElement('div');
  el.className = `ev ${level === 'info' ? '' : level}`;
  el.textContent = text;
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
for (const [t, l, at] of early.splice(0)) log(t, l, at);
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
const CAM_KEY = 'exo.camera';
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
/** The autosave, if it's in this region (one in another region is `elsewhere`: CONTINUE goes there). */
const resumed: AutoSave | null = autosaved && savedRegion === regionId ? autosaved : null;
const elsewhere: AutoSave | null = autosaved && !resumed ? autosaved : null;
const regionLabel = (id: string) => content.regions[id]?.name ?? id;
/** Reload into another region, keeping the other URL options. */
function goRegion(id: string, extra: Record<string, string> = {}) {
  const u = new URL(location.href);
  if (id === 'touchdown') u.searchParams.delete('region'); else u.searchParams.set('region', id);
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
const useTitle = !skirmishMode && !rts && params.get('title') !== '0' && params.get('intro') !== '0' && params.get('new') !== '1' && !params.get('view');
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
  for (const [text, level, at] of heldLog.splice(0)) log(text, level, at);
}
function startLanding() {
  document.body.classList.add('cine');
  const def = preview?.cinematic?.def.scene === 'landing' ? preview.cinematic.def : content.landing;
  if (def.letterbox) document.body.classList.add('cine-bars');
  const piece = new Landing(scene, region, cam, { stage: (s) => sim.command({ type: 'landing', stage: s }) }, def);
  cine = new Cinematic('landing', def, cam, cineHooks(() => { selectFirstDrone = true; endCine(); }), piece);
  // ?cine=<seconds>: start part-way in (the editor's "play from the playhead")
  const from = Number(params.get('cine'));
  if (from > 0) cine.seek(from);
}
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
    sim.command({ type: 'cinematic', id, done: true });
    setSpeed(cineResume);
  }));
  if (from > 0) cine.seek(from);
}
if (rts) {
  // a skirmish starts deployed: the camera on your Command Core
  const h = rts.setup.homes![0];
  cam.fx = h.x; cam.fz = h.z;
  cam.targetDist = cam.dist = 110;
} else if (!skirmishMode && !useTitle) {
  if (resumed) startResume();
  else if (params.get('intro') === '0' || params.get('view')) sim.command({ type: 'landing', stage: 'deploy' });
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
  sim.newGame(Date.now() % 100000);
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.flush(); // overwrite the old autosave right away
  hud.reset();
  storyHud.reset();
  fogView.reset();
  ui.sel = null; setBuild(null);
  selectFirstDrone = true;
  if (rts) { const h = rts.setup.homes![0]; cam.fx = h.x; cam.fz = h.z; }
}
const hud = new ColonyHud({
  defs: content.buildings, units: content.units, research: content.research, inhabitants: content.inhabitants, story: content.story, missions: content.missions, rules: content.colony, people: content.people, ui, cam,
  command: (c) => sim.command(c),
  setBuild,
  restart: () => restartGame(), // (a skirmish: the same map and players again)
  // automated tests (Playwright) don't stop for story pauses unless they asked for a story (?story=<id>, play test)
  pause: (on) => {
    if (navigator.webdriver && !fireStory) return;
    if (on) { storyResume = speed || 1; setSpeed(0); } else if (speed === 0) setSpeed(storyResume);
  },
  load: () => (rts ? showSkirmishSetup() : void loadGame()),
  log,
  onSelect: (kind, role) => storyHud.selected(kind, role),
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
  addEventListener('pagehide', flush);
  setInterval(saveCamera, 10000);
}

// the story inspector: play tests (?preview=1) and ?inspect=1; in dev it also takes story edits live
const inspector = !skirmishMode && (preview || params.get('inspect') === '1')
  ? new Inspector({ content, cur: () => sim.cur, command: (c) => sim.command(c), log })
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
const speedBtns = { 0: $('b-pause'), 1: $('b-play'), 3: $('b-fast') } as Record<number, HTMLElement>;
function setSpeed(s: number) {
  speed = s;
  sim.setSpeed(s);
  for (const [k, b] of Object.entries(speedBtns)) b.classList.toggle('on', Number(k) === s);
}
$('b-pause').onclick = () => setSpeed(0);
$('b-play').onclick = () => setSpeed(1);
$('b-fast').onclick = () => setSpeed(3);

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
/** Terrain style: reloads (the game autosaves first). */
function switchLook() {
  sim.flush();
  const u = new URL(location.href);
  u.searchParams.set('look', look === 'smooth' ? 'flat' : 'smooth');
  location.href = u.toString();
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

const help = $('help');
let helped = false;
const army = skirmish ? null : new ArmyView(scene);
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
  order: (ids, x, z) => { audio.play('order'); sim.command({ type: 'order', ids, x, z }); },
  riders: (ids, t) => {
    const us = sim.cur?.units ?? [], tu = us.find((u) => u.id === t);
    if (!tu || !content.units[tu.unit]?.carries) return [];
    return ids.filter((id) => { const d = content.units[us.find((u) => u.id === id)?.unit ?? '']; return !!d && !d.carries && (d.move ?? 'ground') === 'ground'; });
  },
  board: (ids, t) => { audio.play('order'); sim.command({ type: 'board', ids, transport: t }); },
  setBuild,
  select: () => { if (ui.sel) audio.play('select'); hud.selected(); },
  view: (v) => cam.setView(v),
  togglePause: () => setSpeed(speed === 0 ? 1 : 0),
  toggleBuildMenu: () => hud.toggleMenu(),
  interacted: () => { if (!helped) { helped = true; setTimeout(() => help.classList.add('gone'), 4000); } },
  say: (t) => { log(t, 'warn'); audio.play('deny'); },
  colonistAt: (x, y) => (colonists && cam.dist < 400 ? colonists.pick(x, y, camera, renderer.domElement.getBoundingClientRect()) : -1),
}, army);
$('pl-rotate').onclick = () => input?.rotate();
$('pl-done').onclick = () => setBuild(null);
if (!skirmish) addEventListener('keydown', (e) => {
  // H: to the latest alert (under attack, something lost, contact)
  if ((e.key === 'h' || e.key === 'H') && lastAt && !(e.target instanceof HTMLInputElement)) goTo(lastAt);
  // X: selected combat units stop and guard where they stand
  if (e.key === 'x' && ui.sel?.kind === 'units' && !(e.target instanceof HTMLInputElement)) { audio.play('order'); sim.command({ type: 'stop', ids: ui.sel.ids }); }
});
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
    id: 'look', label: 'Terrain look', help: 'Flat: crisp low-poly facets. Smooth: soft shading with ground textures. Switching reloads the game (it saves first).',
    get: () => look === 'smooth', set: () => switchLook(), state: () => (look === 'smooth' ? 'SMOOTH' : 'FLAT'),
  },
  {
    id: 'glow', label: 'Glow', help: 'Lights, glow strips and gunfire spill soft light. Costs some speed on phones.',
    get: () => post.enabled, set: (v) => { post.enabled = v; remember(GLOW_KEY, v); }, locked: urlLock('bloom'),
  },
  {
    id: 'shadows', label: 'Ground shadows', help: 'Buildings, drones and vehicles cast soft shadows that follow the sun.',
    get: () => !!lights?.shadows, set: (v) => { if (lights) lights.shadows = v; remember(SHADOWS_KEY, v); },
    locked: () => (!lights ? 'Off in URL' : urlLock('shadows')()),
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
    id: 'stats', section: 'Interface', label: 'Performance stats', help: 'View, altitude, frame rate and draw calls, top right.',
    get: () => statsOn, set: (v) => { statsOn = v; document.body.classList.toggle('stats', v); remember(STATS_KEY, v); },
  },
];
const showOptions = (onClose?: () => void, extra: OptionRow[] = [...soundToggles, ...interfaceToggles]) => openOptions([...extra, ...graphicsToggles], () => audio.play('tap'), onClose);

// ---------- game menu (☰ Menu / Esc): pauses while open ----------
let menuOpen = false;
function openGameMenu() {
  if (menuOpen || panelOpen() || skirmish || title) return;
  menuOpen = true;
  const was = speed;
  setSpeed(0);
  let resume = true;
  const back = () => { if (!resume) return; menuOpen = false; if (speed === 0) setSpeed(was || 1); };
  const keep = (fn: () => void) => () => { resume = false; menuOpen = false; fn(); };
  const reopen = () => { resume = true; openGameMenu(); };
  // the menu's buttons close it first; ones that come back to it (Options, What's new) keep the game paused
  const toTitle = () => { const u = new URL(location.href); for (const k of [...u.searchParams.keys()]) if (k !== 'look' && k !== 'sw') u.searchParams.delete(k); location.href = u.toString(); };
  const setup = keep(() => showSkirmishSetup(() => { menuOpen = false; reopen(); }));
  const { el } = openMenu('Menu', rts ? [
    { id: 'resume', label: 'Resume', sub: 'Back to the game (Esc)', run: () => {} },
    { id: 'options', label: 'Options', sub: 'Sound, interface and graphics', run: keep(() => showOptions(() => { menuOpen = false; reopen(); })) },
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
    { id: 'news', label: "What's new", sub: `Version ${VERSION}`, run: keep(() => openWhatsNew(() => { menuOpen = false; reopen(); })) },
    { id: 'skirmish', label: 'Skirmish', sub: 'Set up a battle against the computer (your colony is autosaved)', run: keep(() => { sim.flush(); showSkirmishSetup(() => { menuOpen = false; reopen(); }); }) },
    { id: 'title', label: 'Title screen', sub: 'Your colony is autosaved', run: keep(() => { sim.flush(); saveCamera(); toTitle(); }) },
    { id: 'new', label: 'New game', sub: 'Start over in this region', confirm: 'Your current colony will be lost (unless you Saved it) · tap again', run: () => restartGame() },
  ], `v${VERSION} · M1`, () => audio.play('tap'), () => back());
  el.querySelector('.op-foot')?.classList.add('dim');
}
$('b-menu').onclick = () => openGameMenu();
// Esc opens the menu when there's nothing else for it to do (no selection, not placing, no panel open)
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat || cine || title || panelOpen() || document.getElementById('whatsnew')) return;
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
function showTitle() {
  // Touchdown first, then the rest by name
  // which world each region is on: Home first, then the others by name
  const bodyOf = (id: string) => { const b = content.regions[id]?.body; return b && content.bodies[b] ? b : 'home'; };
  const bodyName = (id: string) => (content.bodies[bodyOf(id)]?.name ?? 'Home').replace(/\b[A-Z]{2,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  const bodyRank = (id: string) => (bodyOf(id) === 'home' ? '' : bodyName(id));
  const regions = Object.keys(content.regions).sort((a, b) => (a === 'touchdown' ? -1 : b === 'touchdown' ? 1 : bodyRank(a).localeCompare(bodyRank(b)) || regionLabel(a).localeCompare(regionLabel(b))));
  const go = (fn: () => void) => () => { void title?.hide().then(() => { title = null; }); fn(); };
  // the title screen's Options also holds where to land and the sound
  const titleOptions: OptionRow[] = [
    ...soundToggles,
    ...(regions.length > 1 ? regions.map((id): Toggle => ({
      id: `region:${id}`, section: 'Region: where New Game lands', label: regionLabel(id), help: bodyName(id),
      get: () => id === regionId, set: () => { if (id !== regionId) goRegion(id); }, state: (on) => (on ? 'HERE' : ''),
    })) : []),
  ];
  const choices = [
    ...(resumed ? [{ id: 'continue', label: 'CONTINUE', sub: `Your colony · ${solTime(resumed.sim.tick)}`, run: go(startResume) }] : []),
    ...(elsewhere ? [{ id: 'continue', label: 'CONTINUE', sub: `Your colony in ${regionLabel(savedRegion)} · ${solTime(elsewhere.sim.tick)}`, run: () => goRegion(savedRegion) }] : []),
    {
      id: 'new', label: 'NEW GAME', sub: regions.length > 1 ? `Land in ${regionDef.name}` : 'Land the probe on a fresh world',
      ...(autosaved && !scratch ? { confirm: `Your colony${elsewhere ? ` in ${regionLabel(savedRegion)}` : ''} at ${solTime(autosaved.sim.tick)} will be lost · tap again` } : {}),
      run: go(startLanding),
    },
    { id: 'skirmish', label: 'SKIRMISH', sub: 'You against the computer: pick a map and players', run: () => showSkirmishSetup() },
    { id: 'options', label: 'OPTIONS', sub: regions.length > 1 ? 'Region, sound and graphics' : 'Sound and graphics', run: () => showOptions(undefined, titleOptions) },
    { id: 'editor', label: 'EDITOR', sub: 'Units, buildings, maps and models (desktop)', href: `${import.meta.env.BASE_URL}editor.html` },
  ];
  title = new TitleScreen(cam, camera, {
    system,
    choices,
    foot: `<button class="t-ver" title="What's new">v${VERSION}${hasUnseen() ? '<span class="badge">NEW</span>' : ''}</button> · M1 · <a href="https://deeek.org/">deeek.org</a>`,
    tap: () => audio.play('tap'),
    // browsers hold sound back until a tap or key (unless they allow autoplay): say so, until it runs
    status: () => (audio.disabled || !audio.on || audio.state === 'running' ? '' : `♪ ${matchMedia('(pointer: coarse)').matches ? 'TAP' : 'CLICK'} ANYWHERE FOR SOUND`),
  });
  const ver = title.root.querySelector<HTMLButtonElement>('.t-ver')!;
  ver.onclick = () => { audio.play('tap'); openWhatsNew(() => ver.querySelector('.badge')?.remove()); };
}

// ground shadows (in the light map): each building kind's body radius and a rough height
const shadowSun = new THREE.Vector3();
const shadowSizes = Object.fromEntries(Object.entries(content.buildings).map(([k, d]) => {
  const r = Math.max(1, (d.clearance ?? 8) / 2 * 0.85);
  return [k, { r, h: d.role === 'wall' || d.role === 'gate' ? 3 : Math.min(r * 1.2, 9) }];
}));
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
const space = new THREE.Color('#020306');
const bg = new THREE.Color();
const t0 = performance.now();
let last = t0;
let ready = false;
let gameT = 0;

function frame(now: number) {
  adaptRes((now - last) / 1000);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = (now - t0) / 1000;

  const simSecs = sim.cur && !skirmish ? sim.cur.secs + sim.alpha(now) * (speed / TICK_HZ) : undefined;
  // skirmish holds a fixed day or night (its ☀/☾ button): the sim clock at that hour
  const sol = content.colony.solSeconds;
  const sunSecs = skirmish ? ((skirmish.hour - START_HOUR) / 24) * sol : simSecs;
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
  // cam.dist alone undercounts during the landing chase (close to the probe, high above the ground)
  const air = 1 - smoothstep(90, 420, Math.max(cam.dist, cam.altitude() * 0.8));
  scene.background = bg.clone().lerp(space, 1 - air);
  updateWater(skirmish ? t : gameT, bg);
  fog.color.copy(bg);
  fog.near = air > 0.01 ? cam.dist * 2.2 : 1e9;
  fog.far = air > 0.01 ? lerp(cam.dist * 9, cam.dist * 60, 1 - air) : 1e9 + 1;

  if (skirmish) {
    region.updateOverlay(cam.dist, t);
    skirmish.update(now, dt);
    if (!ready && skirmish.ready) { ready = true; exo.ready = true; reveal(); }
  } else if (sim.prev && sim.cur) {
    const day = smoothstep(-0.15, 0.25, sunUp);
    cine?.update(dt, day);
    // story cinematics the sim has queued: one at a time, once the landing and title are done
    const queued = sim.cur.story.cine?.[0];
    if (queued && !cine && !title && sim.cur.deployed) {
      const def = preview?.cinematic?.id === queued ? preview.cinematic.def : content.cinematics[queued];
      // automated tests don't sit through cinematics unless they asked for one
      if (!def || def.scene === 'landing' || (navigator.webdriver && !fireCine)) sim.command({ type: 'cinematic', id: queued, done: true });
      else playCinematic(queued, def, queued === fireCine ? Number(params.get('cine')) || 0 : 0);
    }
    region.flora?.update(t, 1 - smoothstep(-0.2, 0.15, sunUp), camera);
    if (selectFirstDrone && !cine && sim.cur.deployed && sim.cur.drones.length) {
      selectFirstDrone = false;
      ui.sel = { kind: 'drone', id: sim.cur.drones[0].id };
      hud.selected();
    }
    if (title) title.update(dt, cam.altitude(), solTime(sim.cur.tick).toUpperCase());
    const alpha = sim.alpha(now);
    // world animations run on game time: frozen when paused, faster at ×3
    gameT += dt * speed;
    region.update(sim.prev, sim.cur, alpha, t, ui, cam.dist, camera, gameT);
    // fog shows once the landing has handed over (the descent keeps its vista)
    fogView.amount = (cine && !cine.world) || title ? 0 : 1;
    fogView.update(sim.cur.fog, dt);
    if (sim.cur.players) army?.setTeamColors(sim.cur.players.map((p) => p.color));
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
    system.fill.intensity = lerp(0.7, 0.32, night);
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
  post?.update({ night: 1 - smoothstep(-0.2, 0.15, sunUp), orbit: 1 - air });
  post ? post.render(dt) : renderer.render(scene, camera);
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
  cam,
  sim,
  skirmish,
  region,
  /** The landing cinematic while it plays. */
  get landing() { return cine && !cine.world ? cine : null; },
  /** Any cinematic while it plays. */
  get cinematic() { return cine; },
  get title() { return title; },
  setView: (v: ViewName, instant = true) => { if (v in VIEWS) cam.setView(v, instant); },
  hud,
  ui,
  army,
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
  capture: () => { post ? post.render(0) : renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
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
