/**
 * The climax on screen (docs/TECH.md "Factions and the climax"): the Lantern's orbital strikes (a warning ring that
 * tightens its pulse, then a beam from the sky, a flash and a scorch that fades), the Clause's interference (a
 * second of tearing across the game view; its log lines are styled in main.ts `log`), and the epilogue: pages shown
 * full screen over the darkened world, one at a time, before the end screen. Endings reached are kept per browser
 * (`exo.endings`) for the title screen's count.
 *
 * Cheap on purpose: a strike is a few small meshes made when it is announced and dropped when it fades; no lights
 * (adding one would recompile every lit material).
 */
import * as THREE from 'three';
import { ENDINGS, ENDING_NAMES, type Ending } from './content/defs';
import type { Epilogue, Snapshot } from './sim/types';
import { regionToWorld } from './world/planet';

const ENDINGS_KEY = 'exo.endings';
/** Endings this browser has reached (the title screen counts them). */
export function endingsReached(): Ending[] {
  try {
    const v = JSON.parse(localStorage.getItem(ENDINGS_KEY) ?? '[]');
    return Array.isArray(v) ? (v as string[]).filter((x): x is Ending => (ENDINGS as readonly string[]).includes(x)) : [];
  } catch { return []; }
}
function rememberEnding(e: string) {
  try {
    const got = endingsReached();
    if ((ENDINGS as readonly string[]).includes(e) && !got.includes(e as Ending)) localStorage.setItem(ENDINGS_KEY, JSON.stringify([...got, e]));
  } catch { /* storage blocked: nothing kept */ }
}
/** The ending's name (Covenant…), or the id as it is. */
export const endingName = (e: string) => ENDING_NAMES[e as Ending] ?? e;
/** The end screen's line for an epilogue: the run in numbers. */
export function epilogueSummary(ep: Epilogue) {
  return [
    `Sol ${ep.sols}`,
    `${ep.colonists} colonist${ep.colonists === 1 ? '' : 's'} alive`,
    ep.deaths ? `${ep.deaths} remembered` : '',
    ep.planet !== null ? `planet health ${ep.planet}` : '',
    ep.allies.length ? `allies: ${ep.allies.join(', ')}` : 'no allies',
  ].filter(Boolean).join(' · ');
}

/** A strip of ground between radii r0 and r1 round (x, z), lifted a little, following the terrain. */
function groundRing(x: number, z: number, r0: number, r1: number, seg = 72, lift = 0.35) {
  const pos: number[] = [], idx: number[] = [], v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const r of [r0, r1]) { regionToWorld(x + c * r, z + s * r, lift, v); pos.push(v.x, v.y, v.z); }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
/** A disc of ground round (x, z) (r = 0 at the centre), following the terrain; `rad` per vertex for fading the edge. */
function groundDisc(x: number, z: number, r: number, rings = 8, seg = 36, lift = 0.25) {
  const pos: number[] = [], col: number[] = [], idx: number[] = [], v = new THREE.Vector3();
  regionToWorld(x, z, lift, v); pos.push(v.x, v.y, v.z); col.push(1, 1, 1);
  for (let j = 1; j <= rings; j++) {
    const rr = (j / rings) * r, k = 1 - j / rings;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      regionToWorld(x + Math.cos(a) * rr, z + Math.sin(a) * rr, lift, v);
      pos.push(v.x, v.y, v.z); col.push(k, k, k);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 1 + ((i + 1) % seg));
  for (let j = 1; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = 1 + (j - 1) * seg + i, b = 1 + (j - 1) * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

interface Warn { key: string; mesh: THREE.Mesh; inner: THREE.Mesh; seen: boolean }
interface Burst { group: THREE.Group; beam: THREE.Mesh; flash: THREE.Mesh; scorch: THREE.Mesh; t: number }

export class ClimaxView {
  private group = new THREE.Group();
  private warns = new Map<string, Warn>();
  private bursts: Burst[] = [];
  private struckN = -1;
  /** Screen tears played so far. */
  private glitchN = -1;
  private tear: HTMLDivElement | null = null;
  private epi: HTMLDivElement | null = null;
  /** The epilogue has been read through (the end screen shows). */
  private epiDone = false;
  private ringMat = new THREE.MeshBasicMaterial({ color: '#ff4d3a', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  private beamMat = new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  private flashMat = new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  private scorchMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.6, depthWrite: false, vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true).translate(0, 0.5, 0);
  private flashGeo = new THREE.SphereGeometry(1, 16, 10);

  constructor(scene: THREE.Scene, private onSound?: (id: 'alarm' | 'deny') => void) {
    this.group.name = 'climax';
    scene.add(this.group);
  }

  /** Per frame, from the newest snapshot. `dt` in real seconds (the beam plays out while paused too). */
  update(cur: Snapshot, dt: number, gameT: number) {
    const st = cur.story;
    // warning rings: one per strike on its way, pulsing faster as it comes
    for (const w of this.warns.values()) w.seen = false;
    for (const k of st.strikes ?? []) {
      const key = `${k.x.toFixed(1)},${k.z.toFixed(1)},${k.r}`;
      let w = this.warns.get(key);
      if (!w) {
        const mesh = new THREE.Mesh(groundRing(k.x, k.z, k.r * 0.92, k.r), this.ringMat.clone());
        const inner = new THREE.Mesh(groundRing(k.x, k.z, 0, k.r * 0.12, 24), this.ringMat.clone());
        this.group.add(mesh, inner);
        w = { key, mesh, inner, seen: true };
        this.warns.set(key, w);
      }
      w.seen = true;
      const rate = 2 + 10 / Math.max(0.6, k.left), pulse = 0.5 + 0.5 * Math.sin(gameT * rate * Math.PI);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.6 * pulse;
      (w.inner.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.5 * (1 - pulse);
    }
    for (const [key, w] of this.warns) if (!w.seen) { this.drop(w.mesh); this.drop(w.inner); this.warns.delete(key); }
    // a strike that landed: the beam, the flash, the scorch
    const s = st.struck;
    // (the first snapshot of a game resumed: strikes and glitches from before aren't played again)
    if (this.struckN < 0) { this.struckN = s?.n ?? 0; this.glitchN = st.glitch?.tears ?? 0; }
    if (s && s.n !== this.struckN) { this.struckN = s.n; this.burst(s.x, s.z, s.r); }
    for (const b of [...this.bursts]) {
      b.t += dt;
      const k = b.t;
      // the beam: full width at once, narrowing and fading over a second
      const bw = Math.max(0, 1 - k / 1.1);
      b.beam.visible = bw > 0;
      b.beam.scale.set(b.beam.userData.r * (0.25 + 0.75 * bw), b.beam.scale.y, b.beam.userData.r * (0.25 + 0.75 * bw));
      (b.beam.material as THREE.MeshBasicMaterial).opacity = bw;
      const fw = Math.max(0, 1 - k / 0.6);
      b.flash.visible = fw > 0;
      b.flash.scale.setScalar(b.flash.userData.r * (0.5 + 1.2 * (1 - fw)));
      (b.flash.material as THREE.MeshBasicMaterial).opacity = fw;
      (b.scorch.material as THREE.MeshBasicMaterial).opacity = 0.65 * Math.min(1, Math.max(0, 1 - (k - 40) / 20));
      if (k > 60) { this.group.remove(b.group); for (const m of [b.beam, b.flash, b.scorch]) (m.material as THREE.Material).dispose(); b.scorch.geometry.dispose(); this.bursts.splice(this.bursts.indexOf(b), 1); }
    }
    // the Clause tears the screen
    const g = st.glitch;
    if (g && (g.tears ?? 0) !== this.glitchN) { this.glitchN = g.tears ?? 0; this.screenTear(); }
    // the epilogue: pages, then the end screen
    if (cur.over && st.epilogue && !this.epi && !this.epiDone) this.showEpilogue(st.epilogue);
  }

  private drop(m: THREE.Mesh) { this.group.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }

  /** The beam from the sky, its flash and the scorch it leaves. */
  burst(x: number, z: number, r: number) {
    const group = new THREE.Group();
    const at = regionToWorld(x, z, 0), up = at.clone().normalize();
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat.clone());
    beam.position.copy(at);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    beam.userData.r = Math.max(1.5, r * 0.32);
    beam.scale.set(beam.userData.r, 900, beam.userData.r);
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    flash.position.copy(regionToWorld(x, z, 1));
    flash.userData.r = r * 0.8;
    const scorch = new THREE.Mesh(groundDisc(x, z, r * 0.95), this.scorchMat.clone());
    scorch.renderOrder = -1;
    group.add(scorch, beam, flash);
    this.group.add(group);
    this.bursts.push({ group, beam, flash, scorch, t: 0 });
  }

  /** About a second of tearing and colour noise over the game view. */
  screenTear() {
    this.tear?.remove();
    const el = document.createElement('div');
    el.id = 'clause-tear';
    for (let i = 0; i < 6; i++) {
      const bar = document.createElement('i');
      bar.style.top = `${Math.round(Math.random() * 92)}%`;
      bar.style.height = `${2 + Math.round(Math.random() * 7)}%`;
      bar.style.animationDelay = `${Math.round(Math.random() * 500)}ms`;
      el.append(bar);
    }
    document.body.append(el);
    document.body.classList.add('clause-glitch');
    document.body.dataset.tears = String(Number(document.body.dataset.tears ?? 0) + 1); // (for tests: tears so far)
    this.tear = el;
    this.onSound?.('deny');
    setTimeout(() => { el.remove(); if (this.tear === el) { this.tear = null; document.body.classList.remove('clause-glitch'); } }, 1100);
  }

  /** The epilogue's pages over the darkened world, one at a time; the end screen after the last. */
  private showEpilogue(ep: Epilogue) {
    rememberEnding(ep.ending);
    if (!ep.pages.length) { this.epiDone = true; return; }
    const el = document.createElement('div');
    el.id = 'epilogue';
    document.body.append(el);
    document.body.classList.add('epilogue-on');
    this.epi = el;
    let i = 0;
    const page = () => {
      const p = ep.pages[i], last = i === ep.pages.length - 1;
      el.replaceChildren();
      const box = document.createElement('div');
      box.className = 'epi-page';
      if (p.title) { const t = document.createElement('h2'); t.textContent = p.title; box.append(t); }
      for (const para of p.text.split(/\n{2,}/)) { const q = document.createElement('p'); q.textContent = para; box.append(q); }
      const btn = document.createElement('button');
      btn.className = 'go';
      btn.id = 'epi-next';
      btn.textContent = last ? 'The end' : 'Next';
      btn.onclick = () => {
        if (!last) { i++; page(); return; }
        el.remove();
        this.epi = null;
        this.epiDone = true;
        document.body.classList.remove('epilogue-on');
      };
      const n = document.createElement('div');
      n.className = 'epi-n';
      n.textContent = `${endingName(ep.ending).toUpperCase()} · ${i + 1} / ${ep.pages.length}`;
      box.append(btn, n);
      el.append(box);
      btn.focus();
    };
    page();
  }

  /** A new game (or the colony restarted): nothing of the last one shows. */
  reset() {
    for (const w of this.warns.values()) { this.drop(w.mesh); this.drop(w.inner); }
    this.warns.clear();
    for (const b of this.bursts) this.group.remove(b.group);
    this.bursts = [];
    this.struckN = -1; this.glitchN = -1;
    this.epi?.remove(); this.epi = null; this.epiDone = false;
    document.body.classList.remove('epilogue-on', 'clause-glitch');
  }
}

/**
 * A Clause log line: monospaced and cold (style.css `.ev.clause`), its letters scrambled for a moment before they
 * settle into the words.
 */
export function scrambleIn(el: HTMLElement, text: string) {
  const glyphs = '01#%/\\<>_=+*:;.[]{}';
  const t0 = performance.now(), len = 650;
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / len);
    const fixed = Math.floor(text.length * k);
    let out = text.slice(0, fixed);
    for (let i = fixed; i < text.length; i++) out += text[i] === ' ' ? ' ' : glyphs[(Math.random() * glyphs.length) | 0];
    el.textContent = out;
    if (k < 1) requestAnimationFrame(tick);
  };
  tick();
}
