import * as THREE from 'three';
import './style.css';
import { VIEWS, ZoomCamera, type ViewName } from './camera';
import { Input } from './input';
import { AUTOSAVE, delSave, getSave, putSave, type AutoSave } from './save';
import { SimClient } from './sim/client';
import { TICK_HZ, type SimState } from './sim/types';
import { content, contentIssues } from './content';
import { lerp, smoothstep } from './world/noise';
import { buildAtmosphere, buildGlobe, R, U, regionHeight, regionToWorld, setRegionTerrain } from './world/planet';
import { Provinces } from './world/provinces';
import { RegionView, groundTextures } from './world/region';
import { SolarSystem } from './world/system';
import { startSkirmish } from './skirmish/mode';
import { Landing } from './landing';
import { loadModel } from './assets/models';
import { ColonyHud } from './colony-hud';
import { ArmyView } from './skirmish/view';
import type { SkSnapshot } from './skirmish/types';
import { linePoints, placeProblem } from './sim/rules';
import { hourAt, sunAngle } from './sim/daylight';
import type { RegionUi } from './world/region';

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
  ['Shaping the landing site…', 40],
  ['Charting the solar system…', 175],
  ['Forming the planet…', 365],
  ['Mapping regions…', 230],
  ['Growing alien flora…', 165],
  ['Building the base…', 120],
  ['Warming up shaders…', 60],
  ['Starting the simulation…', 210],
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
await loadStep('Shaping the landing site…');
setRegionTerrain(regionDef);

// ---------- renderer / scene ----------
const coarse = matchMedia('(pointer: coarse)').matches;
const look = params.get('look') === 'smooth' ? 'smooth' : 'flat';
const skirmishMode = params.get('mode') === 'skirmish';
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.75 : 2));
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
await loadStep('Forming the planet…');
const globe = buildGlobe(look);
if (look === 'smooth') {
  // match the globe to the textured landing patch as seen from a distance
  const m = groundTextures().mean;
  (globe.material as THREE.MeshStandardMaterial).color.setRGB(m, m * 0.98, m * 0.96);
}
scene.add(globe);
await loadStep('Mapping regions…');
const provinces = new Provinces(scene, globe, $('labels'));
// atmosphere glow: only seen from orbit — fade it out before the camera can enter the shell
const atmosphere = buildAtmosphere(R * 1.03, '#8fd6ff', 1.25);
scene.add(atmosphere);
await loadStep(skirmishMode ? 'Raising the battlefield…' : 'Growing alien flora…');
const floraParam = params.get('flora');
const region = new RegionView(
  scene, look,
  skirmishMode || floraParam === 'off' ? null : Number(floraParam ?? regionDef.floraSeed) || regionDef.floraSeed,
  regionDef.floraDensity,
  { defs: content.buildings, buildRadius: content.colony.buildRadius },
);
const cam = new ZoomCamera(camera);
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

const sim = new SimClient(log, !skirmishMode);
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

if (!skirmishMode) {
  if (resumed) {
    sim.load(resumed.sim);
    restoreCamera();
    const sol = content.colony.solSeconds, secs = resumed.sim.tick / TICK_HZ;
    const h = hourAt(secs, sol);
    log(`Welcome back · resumed at Sol ${Math.floor(secs / sol) + 1}, ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} · ⋯ → New game to start over`);
  } else if (params.get('intro') === '0' || params.get('view')) {
    sim.command({ type: 'landing', stage: 'deploy' });
  } else {
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
}
$('cine-skip').onclick = () => landing?.skip();
addEventListener('keydown', (e) => { if (landing && (e.key === 'Escape' || e.key === 'Enter')) landing.skip(); });

// asset models assigned in content replace built-in building models once loaded
for (const [kind, d] of Object.entries(content.buildings)) {
  if (!d.model || !content.assets[d.model] || d.role === 'core') continue;
  loadModel(content.assets[d.model]).then(
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
  ui.sel = null; setBuild(null);
  selectFirstDrone = true;
  document.body.classList.remove('more');
}
const hud = new ColonyHud({
  defs: content.buildings, units: content.units, rules: content.colony, ui, cam,
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
$('b-skirmish').onclick = () => {
  const u = new URL(location.href);
  u.searchParams.set('mode', 'skirmish');
  location.href = u.toString();
};

const help = $('help');
let helped = false;
const army = skirmish ? null : new ArmyView(scene);
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
  say: (t) => log(t, 'warn'),
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
  el.fps.textContent = innerWidth < 640 ? `${fpsShown.toFixed(0)} fps` : `${fpsShown.toFixed(0)} fps · ${renderer.info.render.calls} draws`;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    const v = b.dataset.view;
    b.classList.toggle('on', (v === 'system' && cam.b > 0.5) || (v === 'planet' && cam.a > 0.5 && cam.b <= 0.5) || (v === 'surface' && cam.a <= 0.5));
  });
}

// ---------- reveal + layout ----------
function reveal() {
  loadTimes.push(['first frame', performance.now()]);
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

// ---------- frame loop ----------
const skyDay = new THREE.Color('#8fb0ad');
const skyNight = new THREE.Color('#0b1622');
const space = new THREE.Color('#020306');
const bg = new THREE.Color();
const t0 = performance.now();
let last = t0;
let ready = false;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = (now - t0) / 1000;

  const simSecs = sim.cur && !skirmish ? sim.cur.secs + sim.alpha(now) * (speed / TICK_HZ) : undefined;
  system.update(t + 200, camera, cam.b, 1 - cam.a, innerWidth, innerHeight, simSecs === undefined ? undefined : sunAngle(simSecs, content.colony.solSeconds, U.x, U.z));
  cam.update(dt, system.starPos);
  (atmosphere.material as THREE.ShaderMaterial).uniforms.strength.value = 1.25 * smoothstep(300, 1400, cam.altitude());
  atmosphere.visible = cam.altitude() > 300;
  provinces.update(camera, cam.dist, innerWidth, innerHeight);

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
    const alpha = sim.alpha(now);
    region.update(sim.prev, sim.cur, alpha, t, ui, cam.dist, camera);
    army?.update(asArmy(sim.prev), asArmy(sim.cur), alpha, syncArmySel(), dt);
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
  /** Screen position of a region point on the ground. */
  screenOf: (x: number, z: number, lift = 0) => {
    const v = regionToWorld(x, z, lift).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  },
  canPlace,
  capture: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
  height: regionHeight,
};
(window as unknown as { __exo: typeof exo }).__exo = exo;
