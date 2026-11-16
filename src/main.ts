import * as THREE from 'three';
import './style.css';
import { VIEWS, ZoomCamera, type ViewName } from './camera';
import { Input } from './input';
import { AUTOSAVE, delSave, getSave, putSave, type AutoSave } from './save';
import { SimClient } from './sim/client';
import { TICK_HZ, type SimState } from './sim/types';
import { content, contentIssues } from './content';
import { lerp, smoothstep } from './world/noise';
import { buildAtmosphere, globeMesh, R, U, regionHeight, regionToWorld, setRegionTerrain, type GlobeArrays } from './world/planet';
import { Provinces, type ProvinceData } from './world/provinces';
import { RegionView, groundTextures } from './world/region';
import { SolarSystem } from './world/system';
import { startSkirmish } from './skirmish/mode';
import { Landing } from './landing';
import { loadModel } from './assets/models';
import { ColonyHud } from './colony-hud';
import { FogView, addFog } from './world/fog';
import { ArmyView } from './skirmish/view';
import { ColonistView } from './world/colonists';
import { DEFS as UNIT_DEFS, UT, type SkSnapshot } from './skirmish/types';
import { linePoints, placeProblem } from './sim/rules';
import { hourAt, sunAngle } from './sim/daylight';
import type { RegionUi } from './world/region';
import { GameAudio, type Spatial } from './audio';
import { TitleScreen } from './title';
import { VERSION } from './changelog';
import { hasUnseen, openWhatsNew } from './whatsnew';
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
const regionDef = content.regions.touchdown;
const skirmishMode = params.get('mode') === 'skirmish';
const look = params.get('look') === 'smooth' ? 'smooth' : 'flat';
// Start both workers first so their work overlaps everything below: the sim
// (boots its module graph and a new game) and the globe/province generator.
/** Sim events that arrive before the HUD exists wait here. */
const early: [string, 'info' | 'warn' | 'bad'][] = [];
let logFn: ((text: string, level: 'info' | 'warn' | 'bad') => void) | null = null;
// sound (colony only; ?sound=0 turns it off for good, the ⋯ menu for now)
const audio = new GameAudio(content.sound, content.assets, skirmishMode || params.get('sound') === '0');
const sim = new SimClient((t, l, cue) => {
  if (cue) audio.event(cue);
  if (logFn) logFn(t, l); else early.push([t, l]);
}, !skirmishMode);
const gen = new Promise<{ globe: GlobeArrays; prov: ProvinceData; ms: Record<string, number> }>((res, rej) => {
  const w = new Worker(new URL('./world/gen-worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e) => { res(e.data); w.terminate(); };
  w.onerror = (e) => rej(new Error(e.message || 'generation worker failed'));
  w.postMessage({ look, region: { height: regionDef.height, flora: regionDef.flora } });
});
await loadStep('Shaping the landing site…');
setRegionTerrain(regionDef);

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
  if (next !== res.scale) { res.scale = next; renderer.setPixelRatio(next); renderer.setSize(innerWidth, innerHeight); }
}
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.2, 1.2e7);
const fog = new THREE.Fog('#8fb0ad', 400, 1200);
scene.fog = fog;

await loadStep('Charting the solar system…');
const system = new SolarSystem(scene, $('labels'));
await loadStep(skirmishMode ? 'Raising the battlefield…' : 'Growing alien flora…');
const floraParam = params.get('flora');
const region = new RegionView(
  scene, look,
  skirmishMode || floraParam === 'off' ? null : Number(floraParam ?? regionDef.floraSeed) || regionDef.floraSeed,
  regionDef.floraDensity,
  { defs: content.buildings, buildRadius: content.colony.buildRadius },
);
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
if (surfaceOn) { addSurfaceDetail(globe.material as THREE.MeshStandardMaterial); scene.add(clouds); }
function startSurfaceBake() {
  if (!surfaceOn) return;
  const w = new Worker(new URL('./world/surface-worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<SurfaceMaps & { ms: number }>) => {
    setSurfaceMaps(e.data);
    (window as unknown as { __surfaceMs: number }).__surfaceMs = e.data.ms;
    w.terminate();
  };
  w.postMessage({ region: { height: regionDef.height, flora: regionDef.flora } });
}
await loadStep('Mapping regions…');
const provinces = new Provinces(scene, globe, $('labels'), generated.prov);
(window as unknown as { __genMs: Record<string, number> }).__genMs = generated.ms;
// atmosphere glow: only seen from orbit — fade it out before the camera can enter the shell
const atmosphere = buildAtmosphere(R * 1.03, '#8fd6ff', 1.25);
scene.add(atmosphere);
// fog of war (colony only; ?fog=0 turns it off)
const fogView = new FogView(!skirmishMode && params.get('fog') !== '0');
if (fogView.enabled) { region.enableFog(); addFog(globe.material as THREE.Material); }
await loadStep('Building the base…');

// ---------- HUD ----------
const hudEl = $('hud');
if (params.get('ui') === '0') hudEl.classList.add('hidden');
const logEl = $('log');
const heldLog: [string, 'info' | 'warn' | 'bad'][] = [];
function log(text: string, level: 'info' | 'warn' | 'bad' = 'info') {
  // the landing cinematic hides the log; keep events for when it ends
  if (landing) { heldLog.push([text, level]); return; }
  const el = document.createElement('div');
  el.className = `ev ${level === 'info' ? '' : level}`;
  el.textContent = text;
  logEl.appendChild(el);
  while (logEl.children.length > 5) logEl.firstElementChild!.remove();
  setTimeout(() => el.classList.add('fade'), 9000);
  setTimeout(() => el.remove(), 10500);
}

logFn = log;
for (const [t, l] of early.splice(0)) log(t, l);
const ui: RegionUi = { sel: null, drag: null, build: null, ghost: null };
/** Select the first drone once the landing hands over control. */
let selectFirstDrone = true;

// ---------- landing cinematic ----------
const cineEl = $('cine');
let landing: Landing | null = null;
// ---------- resume where you left off ----------
// The sim worker autosaves every few seconds and whenever the page is hidden
// (phones discard background tabs); on the next visit we pick up from there.
// ?new=1 starts fresh. The camera is remembered separately in localStorage.
const CAM_KEY = 'exo.camera';
function saveCamera() {
  if (title || landing) return; // the title's orbit and the descent aren't where you play from
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
let resumed: AutoSave | null = null;
if (!skirmishMode) {
  if (params.get('new') === '1') await delSave(AUTOSAVE).catch(() => {});
  else {
    const a = await getSave<AutoSave>(AUTOSAVE).catch(() => undefined);
    if (a?.version === 2 && a.sim && !a.sim.over && a.sim.phase === 'deployed') resumed = a;
  }
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
const useTitle = !skirmishMode && params.get('title') !== '0' && params.get('intro') !== '0' && params.get('new') !== '1' && !params.get('view');
if (useTitle) document.body.classList.add('title');
let title: TitleScreen | null = null;

function startResume() {
  if (!resumed) return;
  sim.load(resumed.sim);
  cam.setView('surface'); // the default; a remembered camera overrides it
  restoreCamera();
  log(`Welcome back · resumed at ${solTime(resumed.sim.tick)} · ⋯ → New game to start over`);
}
function startLanding() {
  document.body.classList.add('cine');
  landing = new Landing(scene, region, cam, {
    stage: (s) => sim.command({ type: 'landing', stage: s }),
    caption: (title, sub) => {
      $('cine-title').textContent = title;
      $('cine-sub').textContent = sub;
    },
    done: () => {
      document.body.classList.remove('cine');
      cineEl.classList.add('gone');
      selectFirstDrone = true;
      landing = null;
      for (const [text, level] of heldLog.splice(0)) log(text, level);
    },
  });
}
if (!skirmishMode && !useTitle) {
  if (resumed) startResume();
  else if (params.get('intro') === '0' || params.get('view')) sim.command({ type: 'landing', stage: 'deploy' });
  else startLanding();
}
$('cine-skip').onclick = () => landing?.skip();
addEventListener('keydown', (e) => { if (landing && (e.key === 'Escape' || e.key === 'Enter')) landing.skip(); });

// asset models assigned in content replace built-in building models once loaded.
// ?models=new previews the Blender set (content/assets/exo-<kind>.json) without
// assigning it in content.
const previewModels = params.get('models') === 'new';
const modelFor = (kind: string, assigned?: string) => (previewModels && content.assets[`exo-${kind}`] ? `exo-${kind}` : assigned);
for (const [kind, d] of Object.entries(content.buildings)) {
  const id = modelFor(kind, d.model);
  if (!id || !content.assets[id] || d.role === 'core') continue;
  loadModel(content.assets[id]).then(
    (m) => region.setBuildingModel(kind, m),
    (e) => console.warn(`${kind} model failed to load; keeping the built-in`, e),
  );
}

const canPlace = (kind: string, x: number, z: number) => {
  const c = sim.cur;
  if (!c) return 'not ready';
  if (c.alloys < content.buildings[kind].cost) return `not enough alloys (${content.buildings[kind].cost} needed)`;
  return placeProblem(c, content.buildings, content.colony, kind, x, z);
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
    else log(coarse ? `Tap the ground to preview the ${d.name}, tap it again to build · ⟳ rotates` : `Click to place the ${d.name} · R rotates · Shift-click to place several · Esc to stop`);
  }
}
function restartGame() {
  sim.newGame(Date.now() % 100000);
  sim.command({ type: 'landing', stage: 'deploy' });
  sim.flush(); // overwrite the old autosave right away
  hud.reset();
  fogView.reset();
  ui.sel = null; setBuild(null);
  selectFirstDrone = true;
  document.body.classList.remove('more');
}
const hud = new ColonyHud({
  defs: content.buildings, units: content.units, rules: content.colony, people: content.people, ui, cam,
  command: (c) => sim.command(c),
  setBuild,
  restart: () => restartGame(),
  load: () => $('b-load').click(),
  log,
});
$('b-build').onclick = () => hud.toggleMenu();
$('b-new').onclick = () => { if (confirm('Start a new game? Your current colony will be lost (unless you Saved it).')) restartGame(); };
if (!skirmishMode) {
  sim.autosave(true);
  // phones throw hidden tabs away: save the moment the page goes to the background
  const flush = () => { sim.flush(); saveCamera(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
  setInterval(saveCamera, 10000);
}

// playtesting: ?debug=1 → F8 summons the next predator pack now, F9 adds 500 alloys
if (params.get('debug') === '1') {
  addEventListener('keydown', (e) => {
    if (e.key === 'F8') { e.preventDefault(); sim.command({ type: 'debug', wave: true }); log('Debug: pack summoned', 'warn'); }
    if (e.key === 'F9') { e.preventDefault(); sim.command({ type: 'debug', alloys: 500 }); log('Debug: +500 alloys', 'warn'); }
  });
}

let speed = 1;
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
$('b-save').onclick = async () => {
  try {
    const state = await sim.save();
    const file: SaveFile = { version: 1, savedAt: Date.now(), sim: state, camera: { dist: cam.targetDist, yaw: cam.yaw, pitch: cam.targetPitch, fx: cam.fx, fz: cam.fz } };
    await putSave('slot1', file);
    log(`Saved · tick ${state.tick}`);
  } catch (err) {
    log(`Save failed: ${(err as Error).message}`, 'bad');
  }
};
$('b-load').onclick = async () => {
  try {
    const file = await getSave<SaveFile>('slot1');
    if (!file) { log('No save in this browser yet', 'warn'); return; }
    landing?.skip();
    sim.load(file.sim);
    Object.assign(cam, { yaw: file.camera.yaw, fx: file.camera.fx, fz: file.camera.fz });
    cam.targetDist = file.camera.dist;
    cam.targetPitch = file.camera.pitch;
  } catch (err) {
    log(`Load failed: ${(err as Error).message}`, 'bad');
  }
};

const lookBtn = $<HTMLButtonElement>('b-look');
lookBtn.textContent = look === 'smooth' ? 'Look: Smooth' : 'Look: Flat';
lookBtn.onclick = () => {
  const u = new URL(location.href);
  u.searchParams.set('look', look === 'smooth' ? 'flat' : 'smooth');
  location.href = u.toString();
};

const skirmish = skirmishMode ? startSkirmish({ scene, renderer, cam, region, log, params }) : null;
$('b-news').textContent = `v${VERSION}`;
$('brand-ver').textContent = `v${VERSION}`;
$('b-news').onclick = () => { document.body.classList.remove('more'); $('b-more').classList.remove('on'); openWhatsNew(); };
$('b-skirmish').onclick = () => {
  const u = new URL(location.href);
  u.searchParams.set('mode', 'skirmish');
  location.href = u.toString();
};

const help = $('help');
let helped = false;
if (previewModels) for (const [t, id] of [[UT.Rover, 'rover'], [UT.Tank, 'tank']] as const) {
  const a = content.assets[`exo-${id}`];
  if (a) UNIT_DEFS[t].model = a;
}
const army = skirmish ? null : new ArmyView(scene);
const colonists = skirmish ? null : new ColonistView(region.details);
const input = skirmish ? null : new Input(renderer.domElement, cam, region, ui, {
  move: (drone, x, z) => sim.command({ type: 'move', drone, x, z }),
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
        const ok = !!c && alloys >= cost && !placeProblem(c, content.buildings, content.colony, kind, p.x, p.z);
        if (ok) alloys -= cost;
        return { ...p, ok };
      }),
    };
  },
  buildLine: (kind, x1, z1, x2, z2) => sim.command({ type: 'buildLine', kind, x1, z1, x2, z2 }),
  lineStep: (kind) => content.buildings[kind].clearance + 0.02,
  placeProblem: canPlace,
  buildings: () => sim.cur?.buildings ?? [],
  units: () => sim.cur?.units ?? [],
  order: (ids, x, z) => sim.command({ type: 'order', ids, x, z }),
  setBuild,
  select: () => hud.selected(),
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
  // X: selected combat units stop and guard where they stand
  if (e.key === 'x' && ui.sel?.kind === 'units' && !(e.target instanceof HTMLInputElement)) sim.command({ type: 'stop', ids: ui.sel.ids });
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
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
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
  if (s && !skirmish) hud.update(s, speed, now);
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
}
// panels sit above the bottom bar, whatever height it wraps to
const barEl = $('bar');
const syncBar = () => document.documentElement.style.setProperty('--bar-h', `${barEl.offsetHeight}px`);
new ResizeObserver(syncBar).observe(barEl);
syncBar();
$('b-more').onclick = () => { document.body.classList.toggle('more'); $('b-more').classList.toggle('on'); };

// ---------- sound controls (⋯ on phones) ----------
const soundBtn = $<HTMLButtonElement>('b-sound');
const volEl = $<HTMLInputElement>('sound-vol');
function syncSound() {
  soundBtn.textContent = audio.disabled ? '♪ Off (URL)' : audio.on ? '♪ Sound' : '♪ Muted';
  soundBtn.classList.toggle('on', audio.on && !audio.disabled);
  soundBtn.disabled = volEl.disabled = audio.disabled;
  volEl.value = String(Math.round(audio.volume * 100));
  $('snd').classList.toggle('off', !audio.on || audio.disabled);
}
soundBtn.onclick = () => { audio.setOn(!audio.on); syncSound(); };
volEl.oninput = () => { audio.setVolume(Number(volEl.value) / 100); if (!audio.on) audio.setOn(true); syncSound(); };
syncSound();
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
  const go = (fn: () => void) => () => { void title?.hide().then(() => { title = null; }); fn(); };
  const soundSub = () => (audio.disabled ? 'Off (turned off in the URL)' : audio.on ? 'On · tap to mute' : 'Muted · tap to turn on');
  const choices = [
    ...(resumed ? [{ id: 'continue', label: 'CONTINUE', sub: `Your colony · ${solTime(resumed.sim.tick)}`, run: go(startResume) }] : []),
    {
      id: 'new', label: 'NEW GAME', sub: 'Land the probe on a fresh world',
      ...(resumed ? { confirm: `Your colony at ${solTime(resumed.sim.tick)} will be lost · tap again` } : {}),
      run: go(startLanding),
    },
    { id: 'skirmish', label: 'SKIRMISH', sub: 'Hundreds of units, one battlefield (prototype)', run: () => $('b-skirmish').click() },
    {
      id: 'sound', label: 'SOUND', sub: soundSub(),
      run: () => { if (!audio.disabled) { audio.setOn(!audio.on); syncSound(); } title?.setSub('sound', soundSub()); },
    },
    { id: 'editor', label: 'EDITOR', sub: 'Units, buildings, maps and models (desktop)', href: `${import.meta.env.BASE_URL}editor.html` },
  ];
  title = new TitleScreen(cam, camera, {
    choices,
    foot: `<button class="t-ver" title="What's new">v${VERSION}${hasUnseen() ? '<span class="badge">NEW</span>' : ''}</button> · M1 · <a href="https://deeek.org/">deeek.org</a>`,
    tap: () => audio.play('tap'),
  });
  const ver = title.root.querySelector<HTMLButtonElement>('.t-ver')!;
  ver.onclick = () => { audio.play('tap'); openWhatsNew(() => ver.querySelector('.badge')?.remove()); };
}

// ---------- frame loop ----------
const skyDay = new THREE.Color('#8fb0ad');
const skyNight = new THREE.Color('#0b1622');
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
  system.update(t + 200, camera, cam.b, 1 - cam.a, innerWidth, innerHeight, simSecs === undefined ? undefined : sunAngle(simSecs, content.colony.solSeconds, U.x, U.z));
  cam.update(dt, system.starPos);
  (atmosphere.material as THREE.ShaderMaterial).uniforms.strength.value = 1.25 * smoothstep(300, 1400, cam.altitude());
  atmosphere.visible = cam.altitude() > 300;
  provinces.update(camera, cam.dist, innerWidth, innerHeight);
  if (surfaceOn) { updateSurface(dt, system.sunPos, cam.altitude(), t); updateClouds(clouds, cam.altitude()); }
  if (title) provinces.hide(); // a clean planet behind the title, no map overlay

  // sky: day/night at the landing site, fading to space as we climb
  const sunUp = system.sunPos.clone().normalize().dot(U);
  bg.copy(skyNight).lerp(skyDay, smoothstep(-0.15, 0.25, sunUp));
  // cam.dist alone undercounts during the landing chase (close to the probe, high above the ground)
  const air = 1 - smoothstep(90, 420, Math.max(cam.dist, cam.altitude() * 0.8));
  scene.background = bg.clone().lerp(space, 1 - air);
  fog.color.copy(bg);
  fog.near = air > 0.01 ? cam.dist * 2.2 : 1e9;
  fog.far = air > 0.01 ? lerp(cam.dist * 9, cam.dist * 60, 1 - air) : 1e9 + 1;

  if (skirmish) {
    region.updateOverlay(cam.dist, t);
    skirmish.update(now, dt);
    if (!ready && skirmish.ready) { ready = true; exo.ready = true; reveal(); }
  } else if (sim.prev && sim.cur) {
    const day = smoothstep(-0.15, 0.25, sunUp);
    landing?.update(dt, day);
    region.flora?.update(t, 1 - smoothstep(-0.2, 0.15, sunUp), camera);
    if (selectFirstDrone && !landing && sim.cur.deployed && sim.cur.drones.length) {
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
    fogView.amount = landing || title ? 0 : 1;
    fogView.update(sim.cur.fog, dt);
    army?.update(asArmy(sim.prev), asArmy(sim.cur), alpha, syncArmySel(), dt);
    colonists?.update(sim.prev, sim.cur, alpha, ui.sel?.kind === 'colonist' ? ui.sel.id : null, gameT);
    // sound: only the wind during the landing
    audio.quiet = !!landing || !!title;
    audio.worldFx(sim.cur.fx, sim.cur.tick, cam.fx, cam.fz, spatial);
    audio.ambient(sim.cur.daylight, air, dt);
    if (!ready) { ready = true; exo.ready = true; reveal(); }
  }
  updateHud(dt, now);
  renderer.render(scene, camera);
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
  renderer,
  scene,
  cam,
  sim,
  skirmish,
  region,
  get landing() { return landing; },
  get title() { return title; },
  setView: (v: ViewName, instant = true) => { if (v in VIEWS) cam.setView(v, instant); },
  hud,
  ui,
  army,
  droneScreen: (id?: number) => {
    const d = id === undefined ? null : region.drones.get(id);
    const v = (d ? d.world : region.droneWorld).clone().project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  },
  /** Screen position of a combat unit (by id), or null if it isn't drawn. */
  unitScreen: (id: number) => {
    const u = sim.cur?.units.find((x) => x.id === id);
    if (!u || !army || !army.visible[u.slot]) return null;
    const v = new THREE.Vector3(army.wx[u.slot], army.wy[u.slot] + 1, army.wz[u.slot]).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  },
  colonists,
  /** Screen position of a colonist drawn outdoors (by id), or null. */
  colonistScreen: (id: number) => {
    const c = colonists?.at.get(id);
    if (!c) return null;
    const v = c.world.clone().add(new THREE.Vector3(0, 0, 0)).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  },
  /** Screen position of a region point on the ground. */
  screenOf: (x: number, z: number, lift = 0) => {
    const v = regionToWorld(x, z, lift).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  },
  canPlace,
  capture: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
  height: regionHeight,
  fogView,
  audio,
  res,
  surfaceUniforms,
};
(window as unknown as { __exo: typeof exo }).__exo = exo;
