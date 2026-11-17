/**
 * Skirmish mode wiring: worker client, army renderer, touch input, HUD.
 * Entered with ?mode=skirmish (or the ⚔ Skirmish button).
 */
import { viewH } from '../viewport';
import * as THREE from 'three';
import type { ZoomCamera } from '../camera';
import { regionPoint } from '../world/heightGrid';
import { Ribbon, type RegionView } from '../world/region';
import { SkInput, type SkUi } from './input';
import { DEFS, F, SK_TICK_MS, STRIDE, TYPE_NAMES, type SkFromWorker, type SkSnapshot, type SkToWorker } from './types';
import { ArmyView } from './view';

/** localStorage that tolerates private mode. */
function store(k: string, v?: string) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch { /* storage unavailable */ }
  return null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface SkirmishEnv {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  cam: ZoomCamera;
  region: RegionView;
  log: (text: string, level?: 'info' | 'warn' | 'bad') => void;
  params: URLSearchParams;
}

export function startSkirmish(env: SkirmishEnv) {
  const { scene, renderer, cam, region, log, params } = env;
  document.body.classList.add('skirmish');
  region.hideLandingEntities();
  cam.targetDist = cam.dist = 150;
  cam.targetPitch = cam.pitch = 0.95;
  cam.fz = -6;

  const units = Math.min(1000, Math.max(20, Number(params.get('units')) || 200));
  const waveSize = Math.min(600, Math.max(10, Number(params.get('wave')) || 100));

  // ---------- worker ----------
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const send = (m: SkToWorker) => worker.postMessage(m);
  let prev: SkSnapshot | null = null, cur: SkSnapshot | null = null, curAt = 0;
  worker.onmessage = (e: MessageEvent<SkFromWorker>) => {
    const m = e.data;
    if (m.type === 'event') { log(m.text, m.level); return; }
    prev = cur && m.tick > cur.tick && m.tick - cur.tick <= 6 ? cur : m;
    cur = m;
    curAt = performance.now();
  };
  send({ type: 'reset', units, waveSize });

  const army = new ArmyView(scene);
  const orderRibbon = new Ribbon(new THREE.Color('#ffd27a'), 0.5);
  scene.add(orderRibbon.mesh);
  orderRibbon.mesh.visible = false;
  const marker = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.7, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  marker.visible = false;
  scene.add(marker);
  let markerLife = 0;

  // ---------- selection state ----------
  const ui: SkUi = {
    paint: false,
    selected: new Map(),
    drag: null,
    gens: (s) => (cur && s < cur.slots ? cur.units[s * STRIDE + F.GEN] : -1),
    isPlayer: (s) => !!cur && s < cur.slots && DEFS[cur.units[s * STRIDE + F.TYPE]].team === 0 && !!cur.units[s * STRIDE + F.ALIVE],
  };
  const groups: Map<number, number>[] = [new Map(), new Map(), new Map(), new Map(), new Map()];
  const selEl = $('sk-sel');

  function pruneSelection() {
    if (!cur) return;
    for (const [s, g] of ui.selected) if (!ui.isPlayer(s) || cur.units[s * STRIDE + F.GEN] !== g) ui.selected.delete(s);
  }
  function describeSelection() {
    const c = [0, 0];
    for (const s of ui.selected.keys()) c[army.type[s]]++;
    selEl.textContent = ui.selected.size ? `SELECTED ${ui.selected.size} · ${c[0]} ${TYPE_NAMES[0]} · ${c[1]} ${TYPE_NAMES[1]}` : 'NOTHING SELECTED';
    selEl.classList.toggle('none', !ui.selected.size);
  }

  function move(slots: number[], x: number, z: number) {
    if (!slots.length) return;
    send({ type: 'move', slots, x, z });
    marker.position.copy(regionPoint(x, z, 0.4, new THREE.Vector3()));
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), marker.position.clone().normalize());
    marker.visible = true;
    markerLife = 0.8;
  }

  function recallGroup(n: number, centre: boolean) {
    const g = groups[n];
    ui.selected.clear();
    for (const [s, gen] of g) if (ui.isPlayer(s) && ui.gens(s) === gen) ui.selected.set(s, gen);
    describeSelection();
    if (centre && ui.selected.size) {
      let x = 0, z = 0;
      for (const s of ui.selected.keys()) { x += army.lx[s]; z += army.lz[s]; }
      cam.fx = x / ui.selected.size; cam.fz = z / ui.selected.size;
    }
  }
  function assignGroup(n: number) {
    groups[n] = new Map(ui.selected);
    $(`sk-g${n}`).dataset.count = String(groups[n].size || '');
    log(`Group ${n}: ${groups[n].size} units`);
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  }

  let speed = 1;
  function setSpeed(s: number) {
    speed = s;
    send({ type: 'speed', speed: s });
    $('sk-pause').classList.toggle('on', s === 0);
    $('sk-play').classList.toggle('on', s === 1);
    $('sk-fast').classList.toggle('on', s === 2);
  }

  const help = $('sk-help');
  const input = new SkInput(renderer.domElement, $<HTMLCanvasElement>('sk-overlay'), cam, region, army, ui, {
    move,
    changed: describeSelection,
    interacted: () => help.classList.add('gone'),
    keyGroup: (n, assign) => (assign ? assignGroup(n) : recallGroup(n, false)),
    stop: () => send({ type: 'stop', slots: [...ui.selected.keys()] }),
    togglePause: () => setSpeed(speed === 0 ? 1 : 0),
  });

  // ---------- HUD buttons ----------
  const paintBtn = $('sk-paint');
  paintBtn.onclick = () => { ui.paint = !ui.paint; paintBtn.classList.toggle('on', ui.paint); };
  $('sk-all').onclick = () => {
    ui.selected.clear();
    if (cur) for (let s = 0; s < cur.slots; s++) if (ui.isPlayer(s)) ui.selected.set(s, ui.gens(s));
    describeSelection();
  };
  $('sk-clear').onclick = () => { ui.selected.clear(); describeSelection(); };
  $('sk-stop').onclick = () => send({ type: 'stop', slots: [...ui.selected.keys()] });
  $('sk-pause').onclick = () => setSpeed(0);
  $('sk-play').onclick = () => setSpeed(1);
  $('sk-fast').onclick = () => setSpeed(2);
  $('sk-wave').onclick = () => send({ type: 'wave', count: 150 });
  const unitsBtn = $<HTMLButtonElement>('sk-units');
  unitsBtn.textContent = `Army ${units}`;
  unitsBtn.onclick = () => {
    const steps = [100, 200, 400, 700, 1000];
    const next = steps[(steps.indexOf(units) + 1) % steps.length] ?? 200;
    const u = new URL(location.href);
    u.searchParams.set('units', String(next));
    location.href = u.toString();
  };
  // day / night: the sun runs forward to noon or midnight (a quick dusk or dawn), then holds there
  const timeBtn = $<HTMLButtonElement>('sk-time');
  let night = params.get('time') === 'night' || (params.get('time') !== 'day' && store('exo.skirmish.time') === 'night');
  let hour = night ? 0 : 12;
  const setNight = (n: boolean) => {
    night = n;
    timeBtn.textContent = n ? '☾ Night' : '☀ Day';
    timeBtn.classList.toggle('on', n);
    store('exo.skirmish.time', n ? 'night' : 'day');
  };
  setNight(night);
  timeBtn.onclick = () => setNight(!night);
  addEventListener('keydown', (e) => { if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) setNight(!night); });
  $('sk-landing').onclick = () => {
    const u = new URL(location.href);
    u.searchParams.delete('mode');
    location.href = u.toString();
  };
  // control groups: tap = recall, double-tap = recall + centre, long-press = assign
  for (let n = 1; n <= 4; n++) {
    const b = $(`sk-g${n}`);
    let timer = 0, long = false, lastTap = 0;
    b.addEventListener('pointerdown', () => {
      long = false;
      timer = window.setTimeout(() => { long = true; assignGroup(n); b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 300); }, 500);
    });
    b.addEventListener('pointerup', (e) => {
      clearTimeout(timer);
      if (long) return;
      const now = e.timeStamp;
      recallGroup(n, now - lastTap < 320);
      lastTap = now;
    });
    b.addEventListener('pointerleave', () => clearTimeout(timer));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  describeSelection();
  void input;

  // ---------- per frame ----------
  const stat = {
    army: $('sk-army'), hostile: $('sk-hostile'), wave: $('sk-wavestat'), core: $('sk-core'), score: $('sk-score'), sim: $('sk-simms'),
  };
  let hudAcc = 0;
  return {
    get ready() { return !!(prev && cur); },
    /** Local hour (0..24) of the skirmish's fixed day or night; the renderer puts the sun there. */
    get hour() { return hour; },
    get night() { return night; },
    army,
    ui,
    send,
    /** test hook: screen position of a unit slot, or null if off screen */
    unitScreen(slot: number) {
      const v = new THREE.Vector3(army.wx[slot], army.wy[slot] + 1, army.wz[slot]).project(cam.camera);
      if (!army.visible[slot] || v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) return null;
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * viewH(), type: army.type[slot] };
    },
    update(now: number, dt: number) {
      // 12 hours in ~2.5 s, always forward, stopping at the target
      const target = night ? 24 : 12;
      const h = hour < 12 && night ? hour + 24 : hour;
      if (Math.abs(h - target) > 0.01) {
        const ahead = (((target - h) % 24) + 24) % 24;
        hour = (h + Math.min(ahead, dt * 4.8)) % 24;
      }
      if (!prev || !cur) return;
      const alpha = Math.min(1, (now - curAt) / SK_TICK_MS);
      pruneSelection();
      army.update(prev, cur, alpha, ui.selected, dt, cam.dist);
      // order vector from the selection's centre
      if (ui.drag && ui.selected.size) {
        let x = 0, z = 0;
        for (const s of ui.selected.keys()) { x += army.lx[s]; z += army.lz[s]; }
        orderRibbon.set(x / ui.selected.size, z / ui.selected.size, ui.drag.x, ui.drag.z);
        orderRibbon.mesh.visible = true;
      } else orderRibbon.mesh.visible = false;
      if (markerLife > 0) {
        markerLife -= dt;
        marker.scale.setScalar(1 + (0.8 - markerLife) * 0.8);
        (marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, markerLife / 0.8);
        marker.visible = markerLife > 0;
      }
      hudAcc += dt;
      if (hudAcc > 0.2) {
        hudAcc = 0;
        stat.army.innerHTML = `▲ <b>${cur.players}</b> army`;
        stat.hostile.innerHTML = `✖ <b>${cur.enemies}</b> hostile`;
        stat.wave.textContent = `WAVE ${cur.wave} · next ${Math.ceil(cur.nextWave)}s`;
        stat.core.innerHTML = `⬢ core <b>${Math.round(cur.coreHp / 10)}%</b>`;
        stat.core.className = `r ${cur.coreHp < 300 ? 'bad' : cur.coreHp < 1000 ? 'warn' : ''}`;
        stat.score.textContent = `${cur.kills} kills · ${cur.lost} lost`;
        stat.sim.textContent = `sim ${cur.simMs.toFixed(1)} ms · ${cur.players + cur.enemies} units`;
        describeSelection();
      }
    },
  };
}
