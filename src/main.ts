import * as THREE from 'three';
import './style.css';
import { VIEWS, ZoomCamera, type ViewName } from './camera';
import { Input, type UiState } from './input';
import { getSave, putSave } from './save';
import { SimClient } from './sim/client';
import { SOL_SECONDS, TICK_HZ, type SimState } from './sim/types';
import { lerp, smoothstep } from './world/noise';
import { buildAtmosphere, buildGlobe, R, U } from './world/planet';
import { Provinces } from './world/provinces';
import { RegionView, groundTextures } from './world/region';
import { SolarSystem } from './world/system';
import { startSkirmish } from './skirmish/mode';
import { Landing } from './landing';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

const system = new SolarSystem(scene, $('labels'));
const globe = buildGlobe(look);
if (look === 'smooth') {
  // match the globe to the textured landing patch as seen from a distance
  const m = groundTextures().mean;
  (globe.material as THREE.MeshStandardMaterial).color.setRGB(m, m * 0.98, m * 0.96);
}
scene.add(globe);
const provinces = new Provinces(scene, globe, $('labels'));
// atmosphere glow: only seen from orbit — fade it out before the camera can enter the shell
const atmosphere = buildAtmosphere(R * 1.03, '#8fd6ff', 1.25);
scene.add(atmosphere);
const floraParam = params.get('flora');
const region = new RegionView(scene, look, skirmishMode || floraParam === 'off' ? null : Number(floraParam ?? 1) || 1);
const cam = new ZoomCamera(camera);

// ---------- HUD ----------
const hud = $('hud');
if (params.get('ui') === '0') hud.classList.add('hidden');
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
const ui: UiState = { selected: true, buildMode: false, drag: null, ghost: null };

// ---------- landing cinematic ----------
const cineEl = $('cine');
let landing: Landing | null = null;
if (!skirmishMode) {
  if (params.get('intro') === '0' || params.get('view')) {
    sim.command({ type: 'landing', stage: 'deploy' });
  } else {
    ui.selected = false;
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
        ui.selected = true;
        landing = null;
        for (const [text, level] of heldLog.splice(0)) log(text, level);
      },
    });
  }
}
$('cine-skip').onclick = () => landing?.skip();
addEventListener('keydown', (e) => { if (landing && (e.key === 'Escape' || e.key === 'Enter')) landing.skip(); });

const buildBtn = $<HTMLButtonElement>('b-build');
function setBuildMode(on: boolean) {
  ui.buildMode = on;
  ui.ghost = null;
  buildBtn.classList.toggle('on', on);
  if (on) {
    if (cam.a > 0.3) cam.setView('surface');
    log(coarse ? 'Tap the ground to place the solar array' : 'Click the ground to place the solar array');
  }
}
buildBtn.onclick = () => setBuildMode(!ui.buildMode);

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
  move: (x, z) => sim.command({ type: 'move', x, z }),
  build: (x, z) => sim.command({ type: 'build', kind: 'solar', x, z }),
  setBuildMode,
  view: (v) => cam.setView(v),
  togglePause: () => setSpeed(speed === 0 ? 1 : 0),
  interacted: () => { if (!helped) { helped = true; setTimeout(() => help.classList.add('gone'), 4000); } },
});

const initial = params.get('view') as ViewName | null;
if (initial && initial in VIEWS) cam.setView(initial, true);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- HUD refresh ----------
const el = {
  energy: $('r-energy'), alloys: $('r-alloys'), cryo: $('r-cryo'), clock: $('r-clock'),
  layer: $('layer'), alt: $('alt'), fps: $('fps'),
};
function fmtAlt(u: number) {
  const km = u * 0.01; // 1 unit ≈ 10 m
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 10000) return `${Math.round(km).toLocaleString()} km`;
  return `${(km / 1000).toFixed(1)}k km`;
}
let fpsAcc = 0, fpsN = 0, fpsShown = 0;
function updateHud(dt: number) {
  const s = sim.cur;
  if (s && !skirmish) {
    const ok = s.gen >= s.draw;
    el.energy.innerHTML = `⚡ <b>${s.gen.toFixed(1)}</b> / ${s.draw.toFixed(1)} MW`;
    el.energy.className = `r ${ok ? '' : 'warn'}`;
    el.alloys.innerHTML = `◆ <b>${Math.floor(s.alloys)}</b>`;
    el.cryo.innerHTML = `❄ <b>${s.cryo.toFixed(1)}%</b>`;
    el.cryo.className = `r ${s.cryo < 30 ? 'bad' : s.cryo < 100 && !ok ? 'warn' : ''}`;
    const secs = s.tick / TICK_HZ;
    const sol = Math.floor(secs / SOL_SECONDS) + 1;
    const dayMin = Math.floor(((secs % SOL_SECONDS) / SOL_SECONDS) * 1440 + 360) % 1440;
    el.clock.textContent = `SOL ${sol} · ${String(Math.floor(dayMin / 60)).padStart(2, '0')}:${String(dayMin % 60).padStart(2, '0')}${speed === 0 ? ' · PAUSED' : speed > 1 ? ` · ×${speed}` : ''}`;
  }
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

  system.update(t + 200, camera, cam.b, 1 - cam.a, innerWidth, innerHeight);
  cam.update(dt, system.starPos);
  (atmosphere.material as THREE.ShaderMaterial).uniforms.strength.value = 1.25 * smoothstep(300, 1400, cam.altitude());
  atmosphere.visible = cam.altitude() > 300;
  provinces.update(camera, cam.dist, innerWidth, innerHeight);

  // sky: day/night at the landing site, fading to space as we climb
  const sunUp = system.starPos.clone().normalize().dot(U);
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
    if (!ready && skirmish.ready) { ready = true; exo.ready = true; }
  } else if (sim.prev && sim.cur) {
    const day = smoothstep(-0.15, 0.25, sunUp);
    landing?.update(dt, day);
    region.flora?.update(t, 1 - smoothstep(-0.2, 0.15, sunUp), camera);
    region.update(sim.prev, sim.cur, sim.alpha(now), t, ui, cam.dist, 1 - cam.a);
    if (!ready) { ready = true; exo.ready = true; }
  }
  updateHud(dt);
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
  droneScreen: () => {
    const v = region.droneWorld.clone().project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  },
  capture: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
};
(window as unknown as { __exo: typeof exo }).__exo = exo;
