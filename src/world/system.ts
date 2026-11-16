/**
 * The solar system around the home planet. The home planet is fixed at the
 * origin (floating origin), so the star and every other body move relative to
 * it. Distances are compressed for play, not to physical scale.
 */
import * as THREE from 'three';
import { fbm3, smoothstep } from './noise';
import { R as HOME_R, U, buildAtmosphere } from './planet';

type Parent = 'star' | 'home' | Body;

interface Body {
  name: string;
  sub: string;
  obj: THREE.Object3D;
  radius: number;
  orbit: number; // semi-major axis
  ecc: number;
  incl: number;
  period: number; // real seconds per orbit
  phase: number;
  parent: Parent;
  kind: 'planet' | 'moon' | 'comet';
  label?: HTMLDivElement;
  marker?: THREE.Sprite;
  tail?: THREE.Mesh;
  pos: THREE.Vector3;
}

const HOME_ORBIT = 75000;
const HOME_PERIOD = 3600;
// start with the star above the landing site's horizon
const HOME_PHASE = Math.atan2(-U.z, -U.x);
const STAR_R = 5200;

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

let markerTex: THREE.Texture | null = null;
function markerSprite(color: string): THREE.Sprite {
  if (!markerTex) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d')!;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.stroke();
    markerTex = new THREE.CanvasTexture(cv);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: markerTex, color, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
  }));
  s.renderOrder = 5;
  return s;
}

function rockyPlanet(radius: number, sd: number, palette: string[], detail = 14, bump = 0.035): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  const cols = palette.map((p) => new THREE.Color(p));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const n = fbm3(d.x * 2.2 + sd, d.y * 2.2, d.z * 2.2, 4, sd);
    const t = smoothstep(-0.35, 0.35, n) * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(t));
    c.copy(cols[k]).lerp(cols[k + 1], t - k);
    col.set([c.r, c.g, c.b], i * 3);
    const h = 1 + Math.max(0, n) * bump;
    pos.setXYZ(i, d.x * radius * h, d.y * radius * h, d.z * radius * h);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
}

function giant(radius: number, palette: string[], sd: number, ring?: { inner: number; outer: number; color: string; opacity: number; tilt: number }): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(radius, 64, 40);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const bands = palette.map((p) => new THREE.Color(p));
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const lat = v.y + fbm3(v.x * 3, v.y * 3, v.z * 3, 3, sd) * 0.08;
    const b = (lat * 6 + 10) % bands.length;
    const k = Math.floor(b);
    c.copy(bands[k]).lerp(bands[(k + 1) % bands.length], smoothstep(0.6, 1, b - k));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
  if (ring) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(radius * ring.inner, radius * ring.outer, 128, 1),
      new THREE.MeshBasicMaterial({ color: ring.color, transparent: true, opacity: ring.opacity, side: THREE.DoubleSide, depthWrite: false }),
    );
    r.rotation.x = -Math.PI / 2 + ring.tilt;
    g.add(r);
  }
  return g;
}

function glowTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,240,210,1)');
  gr.addColorStop(0.2, 'rgba(255,200,120,0.55)');
  gr.addColorStop(0.5, 'rgba(255,150,60,0.12)');
  gr.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function belt(count: number, r0: number, r1: number, thick: number, size: [number, number], color: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, r = r0 + (rnd() + rnd()) * 0.5 * (r1 - r0);
    p.set(Math.cos(a) * r, (rnd() - 0.5) * thick, Math.sin(a) * r);
    q.setFromEuler(e.set(rnd() * 6, rnd() * 6, rnd() * 6));
    const s = size[0] + rnd() ** 3 * (size[1] - size[0]);
    sc.set(s, s * (0.6 + rnd() * 0.5), s * (0.7 + rnd() * 0.4));
    mesh.setMatrixAt(i, m.compose(p, q, sc));
  }
  return mesh;
}

export class SolarSystem {
  readonly starPos = new THREE.Vector3();
  /** Where the sun (and light) is drawn: follows the day near the surface. */
  readonly sunPos = new THREE.Vector3();
  readonly group = new THREE.Group();
  private bodies: Body[] = [];
  private star: THREE.Group;
  private light: THREE.PointLight;
  private rings: THREE.Line[] = [];
  private belts: THREE.InstancedMesh[] = [];
  private labelLayer: HTMLElement;
  private homeLabel: HTMLDivElement;
  private homeMarker: THREE.Sprite;
  private stars: THREE.Points;

  constructor(scene: THREE.Scene, labelLayer: HTMLElement) {
    this.labelLayer = labelLayer;
    scene.add(this.group);

    // star
    this.star = new THREE.Group();
    this.star.add(new THREE.Mesh(
      new THREE.SphereGeometry(STAR_R, 48, 32),
      new THREE.MeshBasicMaterial({ color: '#fff1d6', toneMapped: false, fog: false }),
    ));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    glow.scale.setScalar(STAR_R * 10);
    this.star.add(glow);
    this.group.add(this.star);
    this.light = new THREE.PointLight('#fff4e4', 3.2, 0, 0);
    this.group.add(this.light);
    this.group.add(new THREE.AmbientLight('#8fa6c0', 0.12));
    // sky fill oriented to the landing site so slopes facing away from the sun aren't black
    const fill = new THREE.HemisphereLight('#bcd7e0', '#4a3024', 0.7);
    fill.position.copy(U);
    this.group.add(fill);

    const add = (b: Omit<Body, 'pos' | 'ecc' | 'incl' | 'kind'> & Partial<Pick<Body, 'ecc' | 'incl' | 'kind'>>) => {
      const kind = b.kind ?? (b.parent === 'star' ? 'planet' : 'moon');
      const body: Body = { ecc: 0, incl: (rnd() - 0.5) * 0.04, ...b, kind, pos: new THREE.Vector3() };
      this.group.add(body.obj);
      body.label = this.makeLabel(b.name, b.sub, kind);
      body.marker = markerSprite(kind === 'planet' ? '#5ff3ff' : kind === 'comet' ? '#c8f0ff' : '#9fb7c4');
      this.group.add(body.marker);
      this.bodies.push(body);
      return body;
    };
    const moon = (parent: Body | 'home', name: string, r: number, orbit: number, period: number, palette: string[]) =>
      add({ name, sub: '', obj: rockyPlanet(r, Math.floor(rnd() * 90), palette, r > 500 ? 10 : 6, 0.06), radius: r, orbit, period, phase: rnd() * 6.28, parent });

    const grey = ['#4b4b52', '#77746f', '#a29d94'];
    const rust = ['#5b3a2c', '#8f5e40', '#c9a27c'];
    const ice = ['#8ea5b5', '#c9d8e2', '#eef4f8'];
    const sulfur = ['#6e5a22', '#c9a43a', '#efe08a', '#8a3d1e'];

    // 1–2: hot inner rocks
    add({ name: 'CINDER', sub: 'molten', obj: rockyPlanet(900, 41, ['#2a1410', '#6b2412', '#d2551c', '#ffb347'], 10, 0.05), radius: 900, orbit: 22000, period: 700, phase: 0.3, parent: 'star' });
    add({ name: 'ASH', sub: 'airless', obj: rockyPlanet(1300, 42, ['#3a3633', '#6d655d', '#9a8f84'], 12), radius: 1300, orbit: 36000, period: 1300, phase: 3.9, parent: 'star' });
    // 3: temperate — Kindred's world (unknown to the player yet)
    const inner = rockyPlanet(2600, 3, ['#1f4e79', '#2f7d5b', '#6c8f4a', '#c9c3a0'], 16);
    inner.add(buildAtmosphere(2600 * 1.06, '#7fc4ff', 1.1));
    add({ name: 'VERDANCE', sub: 'temperate · signal: none', obj: inner, radius: 2600, orbit: 52000, period: 2300, phase: 1.2, parent: 'star' });
    // 4: home moon (home itself is the origin)
    moon('home', 'SELA', 600, 14000, 500, grey);
    // 5: cold desert + two captured rocks
    const desert = add({ name: 'DUNMORE', sub: 'cold desert', obj: rockyPlanet(1700, 51, ['#7a4a33', '#b07a52', '#d9b48c', '#efe2cf'], 12), radius: 1700, orbit: 100000, period: 5400, phase: 5.2, parent: 'star' });
    moon(desert, 'DUNMORE a', 150, 5000, 90, rust);
    moon(desert, 'DUNMORE b', 110, 7600, 160, grey);
    // main belt
    const main = belt(3200, 122000, 148000, 2500, [60, 520], '#8a7f73');
    this.star.add(main);
    this.belts.push(main);
    // 6: banded gas giant + four moons
    const g1 = add({ name: 'THALASSA', sub: 'gas giant · 4 moons', obj: giant(11000, ['#c99a6b', '#e6cfa6', '#a5674a', '#d9b58a', '#7f5a49'], 9), radius: 11000, orbit: 190000, period: 14000, phase: 2.6, parent: 'star' });
    moon(g1, 'IO-T', 900, 26000, 160, sulfur);
    moon(g1, 'KORA', 700, 34000, 240, ice);
    moon(g1, 'MAREN', 1100, 44000, 380, grey);
    moon(g1, 'PIP', 400, 56000, 520, rust);
    // 7: ringed gas giant + two moons
    const g2 = add({ name: 'HALCYON', sub: 'ringed giant · 2 moons', obj: giant(9000, ['#d8c9a0', '#efe3c4', '#b8a27a', '#cdbb91'], 19, { inner: 1.35, outer: 2.3, color: '#d6c39c', opacity: 0.4, tilt: 0.42 }), radius: 9000, orbit: 260000, period: 20000, phase: 4.6, parent: 'star' });
    moon(g2, 'VESS', 800, 30000, 260, ice);
    moon(g2, 'ORRIN', 500, 40000, 360, grey);
    // 8: ice giant + one moon
    const ig = add({ name: 'NEREID', sub: 'ice giant · 1 moon', obj: giant(6000, ['#5fa8b8', '#78c2cf', '#4d93a6', '#8fd1da'], 29, { inner: 1.5, outer: 1.8, color: '#9fd8e0', opacity: 0.18, tilt: 1.1 }), radius: 6000, orbit: 330000, period: 26000, phase: 0.9, parent: 'star' });
    moon(ig, 'TETH', 700, 20000, 200, ice);
    // 9: frozen outer world — Engram's
    const outer = rockyPlanet(2400, 21, ['#9fb6c8', '#d5e2ea', '#f4f8fb', '#7e93a6'], 16);
    outer.add(buildAtmosphere(2400 * 1.05, '#bfe4ff', 0.6));
    add({ name: 'RIME', sub: 'frozen · hostile to biology', obj: outer, radius: 2400, orbit: 390000, period: 32000, phase: 4.1, parent: 'star' });
    // outer icy belt
    const kuiper = belt(1600, 430000, 490000, 9000, [120, 900], '#a9b9c4');
    this.star.add(kuiper);
    this.belts.push(kuiper);
    // two comets on eccentric orbits
    for (const [name, a, e, period, phase, incl] of [['COMET K-7', 260000, 0.86, 9000, 1.7, 0.25], ['COMET VARRO', 340000, 0.9, 13000, 4.2, -0.35]] as const) {
      const c = add({ name, sub: '', obj: rockyPlanet(160, Math.floor(rnd() * 90), ice, 3, 0.2), radius: 160, orbit: a, ecc: e, incl, period, phase, parent: 'star', kind: 'comet' });
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(1, 1, 16, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#bfefff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      c.tail = tail;
      this.group.add(tail);
    }

    this.homeLabel = this.makeLabel('HOME', 'landing site', 'planet');
    this.homeMarker = markerSprite('#ffb547');
    this.group.add(this.homeMarker);

    // orbit paths, drawn around the star (home included)
    const ringMat = (op: number) => new THREE.LineBasicMaterial({ color: '#5ff3ff', transparent: true, opacity: op, depthWrite: false, fog: false });
    const path = (a: number, e: number, incl: number, op = 0.35) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 384; i++) {
        const th = (i / 384) * Math.PI * 2;
        const r = (a * (1 - e * e)) / (1 + e * Math.cos(th));
        pts.push(new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r * Math.sin(incl), Math.sin(th) * r * Math.cos(incl)));
      }
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat(op));
      l.userData.op = op;
      return l;
    };
    const homeRing = path(HOME_ORBIT, 0, 0);
    this.star.add(homeRing);
    this.rings.push(homeRing);
    for (const b of this.bodies) {
      if (b.parent !== 'star') continue;
      const l = path(b.orbit, b.ecc, b.incl, b.kind === 'comet' ? 0.15 : 0.35);
      this.star.add(l);
      this.rings.push(l);
    }

    // background stars, re-centred on the camera every frame
    const N = 6000;
    const sp = new Float32Array(N * 3);
    const sc2 = new Float32Array(N * 3);
    const tint = new THREE.Color();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      p.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(6e6);
      sp.set([p.x, p.y, p.z], i * 3);
      tint.setHSL(0.55 + rnd() * 0.15, 0.4, 0.55 + rnd() * 0.4);
      sc2.set([tint.r, tint.g, tint.b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc2, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);
  }

  private makeLabel(name: string, sub: string, kind: Body['kind']) {
    const el = document.createElement('div');
    el.className = `label ${kind}`;
    el.innerHTML = `${name}${sub ? `<small>${sub}</small>` : ''}`;
    el.style.opacity = '0';
    this.labelLayer.appendChild(el);
    return el;
  }

  private orbitPos(b: Body, t: number, center: THREE.Vector3, out: THREE.Vector3) {
    const th = b.phase + (t / b.period) * Math.PI * 2;
    const r = (b.orbit * (1 - b.ecc * b.ecc)) / (1 + b.ecc * Math.cos(th));
    return out.set(center.x + Math.cos(th) * r, center.y + Math.sin(th) * r * Math.sin(b.incl), center.z + Math.sin(th) * r * Math.cos(b.incl));
  }

  /**
   * `t` in seconds; `sys` 0..1 = how far into the system view the camera is.
   * `sunAngle` (optional): where the planet's day puts the sun, as an angle in
   * the xz-plane. Near the surface the sun and light follow it (so day/night
   * matches the sim's clock); in the system view the star sits at its orbit.
   */
  update(t: number, camera: THREE.PerspectiveCamera, sys: number, surface: number, width: number, height: number, sunAngle?: number) {
    const ha = HOME_PHASE + (t / HOME_PERIOD) * Math.PI * 2;
    // home orbits the star; we keep home at the origin, so the star sits at -homeOrbit
    this.starPos.set(-Math.cos(ha) * HOME_ORBIT, 0, -Math.sin(ha) * HOME_ORBIT);
    if (sunAngle === undefined) this.sunPos.copy(this.starPos);
    else this.sunPos.set(Math.cos(sunAngle) * HOME_ORBIT, 0, Math.sin(sunAngle) * HOME_ORBIT).lerp(this.starPos, smoothstep(0.05, 0.5, sys));
    this.star.position.copy(this.sunPos);
    this.light.position.copy(this.sunPos);
    this.belts[0].rotation.y = t * 0.0004;
    this.belts[1].rotation.y = t * 0.00008;

    const origin = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (const b of this.bodies) {
      const c = b.parent === 'star' ? this.starPos : b.parent === 'home' ? origin : b.parent.pos;
      this.orbitPos(b, t, c, b.pos);
      b.obj.position.copy(b.pos);
      b.obj.rotation.y = t * 0.02;
      const camD = camera.position.distanceTo(b.pos);
      // screen-constant ring so small bodies stay findable from far away
      let k: number;
      if (b.kind === 'moon') {
        const pd = b.parent === 'home' ? camera.position.length() : camera.position.distanceTo((b.parent as Body).pos);
        const pr = b.parent === 'home' ? HOME_R : (b.parent as Body).radius;
        k = smoothstep(pr * 25, pr * 10, pd) * smoothstep(b.radius * 6, b.radius * 30, camD) * (1 - surface);
      } else {
        k = smoothstep(0.1, 0.5, sys);
      }
      const m = b.marker!;
      m.visible = k > 0.01;
      m.position.copy(b.pos);
      m.scale.setScalar(Math.max(b.radius * 2.6, camD * (b.kind === 'planet' ? 0.028 : 0.018)));
      (m.material as THREE.SpriteMaterial).opacity = k * 0.8;
      (b as Body & { k: number }).k = k;
      if (b.tail) {
        const dSun = b.pos.distanceTo(this.starPos);
        const len = 60000 * smoothstep(200000, 30000, dSun) + 2000;
        b.tail.position.copy(b.pos);
        b.tail.lookAt(v.copy(b.pos).multiplyScalar(2).sub(this.starPos)); // point away from the star
        b.tail.scale.set(len * 0.08, len * 0.08, len);
        b.tail.visible = sys > 0.05;
        (b.tail.material as THREE.MeshBasicMaterial).opacity = 0.25 * smoothstep(0.05, 0.4, sys);
      }
    }

    for (const r of this.rings) {
      (r.material as THREE.LineBasicMaterial).opacity = r.userData.op * sys;
      r.visible = sys > 0.01;
    }
    const hk = smoothstep(0.1, 0.5, sys);
    this.homeMarker.visible = hk > 0.01;
    this.homeMarker.scale.setScalar(Math.max(HOME_R * 2.6, camera.position.length() * 0.028));
    (this.homeMarker.material as THREE.SpriteMaterial).opacity = hk * 0.9;
    this.stars.position.copy(camera.position);
    (this.stars.material as THREE.PointsMaterial).opacity = 1 - surface * 0.92;

    // labels
    const place = (el: HTMLDivElement, p: THREE.Vector3, k: number) => {
      v.copy(p).project(camera);
      if (k < 0.02 || v.z > 1) { el.style.opacity = '0'; return; }
      el.style.opacity = String(k);
      el.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -140%)`;
    };
    for (const b of this.bodies) place(b.label!, b.pos, (b as Body & { k: number }).k);
    place(this.homeLabel, origin, hk);
  }
}
