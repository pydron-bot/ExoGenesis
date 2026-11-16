import * as THREE from 'three';
import './style.css';
import { VIEWS, ZoomCamera, type ViewName } from './camera';
import { Input } from './input';
import { getSave, putSave } from './save';
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
import { placeProblem } from './sim/rules';
import { sunAngle } from './sim/daylight';
import type { RegionUi } from './world/region';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- loading screen (markup + styles are inline in index.html) ----------
const loaderEl = $('loader');
/** Show a loading step and let the browser paint it before the next chunk of work. */
async function loadStep(text: string, pct: number) {
  $('loader-step').textContent = text;
  $('loader-bar').style.width = `${pct}%`;
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
function loaderError(msg: string) {
  const step = $('loader-step');
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
await loadStep('Shaping the landing site…', 10);
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

await loadStep('Charting the solar system…', 22);
const system = new SolarSystem(scene, $('labels'));
await loadStep('Forming the planet…', 34);
const globe = buildGlobe(look);
if (look === 'smooth') {
  // match the globe to the textured landing patch as seen from a distance
  const m = groundTextures().mean;
  (globe.material as THREE.MeshStandardMaterial).color.setRGB(m, m * 0.98, m * 0.96);
}
scene.add(globe);
await loadStep('Mapping regions…', 50);
const provinces = new Provinces(scene, globe, $('labels'));
// atmosphere glow: only seen from orbit — fade it out before the camera can enter the shell
const atmosphere = buildAtmosphere(R * 1.03, '#8fd6ff', 1.25);
scene.add(atmosphere);
await loadStep(skirmishMode ? 'Raising the battlefield…' : 'Growing alien flora…', 64);
const floraParam = params.get('flora');
const region = new RegionView(
  scene, look,
  skirmishMode || floraParam === 'off' ? null : Number(floraParam ?? regionDef.floraSeed) || regionDef.floraSeed,
  regionDef.floraDensity,
  { defs: content.buildings, buildRadius: content.colony.buildRadius },
);
const cam = new ZoomCamera(camera);
await loadStep('Waking the cryo bank…', 84);

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
if (!skirmishMode) {
  if (params.get('intro') === '0' || params.get('view')) {
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
function setBuild(kind: string | null) {
  ui.build = kind;
  ui.ghost = null;
  if (kind) {
    if (cam.a > 0.3) cam.setView('surface');
    const d = content.buildings[kind];
    log(coarse ? `Tap the ground to preview the ${d.name}, tap it again to build` : `Click to place the ${d.name} · Shift-click to place several · Esc to stop`);
  }
}
const hud = new ColonyHud({
  defs: content.buildings, rules: content.colony, ui, cam,
  command: (c) => sim.command(c),
  setBuild,
  restart: () => {
    sim.newGame(Date.now() % 100000);
    sim.command({ type: 'landing', stage: 'deploy' });
    hud.reset();
    ui.sel = null; setBuild(null);
    selectFirstDrone = true;
  },
  load: () => $('b-load').click(),
  log,
});
$('b-build').onclick = () => hud.toggleMenu();

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
if (!skirmish) new Input(renderer.domElement, cam, region, ui, {
  move: (drone, x, z) => sim.command({ type: 'move', drone, x, z }),
  build: (kind, x, z) => sim.command({ type: 'build', kind, x, z }),
  placeProblem: canPlace,
  buildings: () => sim.cur?.buildings ?? [],
  setBuild,
  select: () => hud.selected(),
  view: (v) => cam.setView(v),
  togglePause: () => setSpeed(speed === 0 ? 1 : 0),
  toggleBuildMenu: () => hud.toggleMenu(),
  interacted: () => { if (!helped) { helped = true; setTimeout(() => help.classList.add('gone'), 4000); } },
  say: (t) => log(t, 'warn'),
});
const army = skirmish ? null : new ArmyView(scene);
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
  $('loader-step').textContent = 'Ready';
  $('loader-bar').style.width = '100%';
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
    army?.update(asArmy(sim.prev), asArmy(sim.cur), alpha, new Map(), dt);
    if (!ready) { ready = true; exo.ready = true; reveal(); }
  }
  updateHud(dt, now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
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
