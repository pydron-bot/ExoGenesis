/**
 * The solar system around the home planet. The home planet is fixed at the
 * origin (floating origin), so the star and every other body move relative to
 * it. One star, four planets, three moons and an asteroid belt.
 */
import * as THREE from 'three';
import { fbm3, smoothstep } from './noise';
import { buildAtmosphere, U } from './planet';

interface Body {
  name: string;
  sub: string;
  obj: THREE.Object3D;
  radius: number;
  orbit: number;
  period: number; // real seconds per orbit
  phase: number;
  parent: 'star' | Body | 'home';
  label?: HTMLDivElement;
  marker?: THREE.Sprite;
  pos: THREE.Vector3;
}

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

const HOME_ORBIT = 15000;
const HOME_PERIOD = 3600;
// start with the star above the landing site's horizon
const HOME_PHASE = Math.atan2(-U.z, -U.x);

function rockyPlanet(radius: number, seed: number, palette: string[], detail = 14): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  const cols = palette.map((p) => new THREE.Color(p));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const n = fbm3(d.x * 2.2 + seed, d.y * 2.2, d.z * 2.2, 4, seed);
    const t = smoothstep(-0.35, 0.35, n) * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(t));
    c.copy(cols[k]).lerp(cols[k + 1], t - k);
    col.set([c.r, c.g, c.b], i * 3);
    const h = 1 + Math.max(0, n) * 0.035;
    pos.setXYZ(i, d.x * radius * h, d.y * radius * h, d.z * radius * h);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
}

function gasGiant(radius: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(radius, 64, 40);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const bands = ['#c99a6b', '#e6cfa6', '#a5674a', '#d9b58a', '#7f5a49'].map((p) => new THREE.Color(p));
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const lat = v.y + fbm3(v.x * 3, v.y * 3, v.z * 3, 3, 9) * 0.08;
    const b = (lat * 6 + 10) % bands.length;
    const k = Math.floor(b);
    c.copy(bands[k]).lerp(bands[(k + 1) % bands.length], smoothstep(0.6, 1, b - k));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.4, radius * 2.2, 128, 1),
    new THREE.MeshBasicMaterial({ color: '#cdb594', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2 + 0.35;
  g.add(ring);
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

export class SolarSystem {
  readonly starPos = new THREE.Vector3();
  readonly group = new THREE.Group();
  private bodies: Body[] = [];
  private star: THREE.Group;
  private light: THREE.PointLight;
  private rings: THREE.LineLoop[] = [];
  private belt: THREE.InstancedMesh;
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
      new THREE.SphereGeometry(1400, 48, 32),
      new THREE.MeshBasicMaterial({ color: '#fff1d6', toneMapped: false, fog: false }),
    ));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    glow.scale.setScalar(14000);
    this.star.add(glow);
    this.group.add(this.star);
    this.light = new THREE.PointLight('#fff4e4', 3.2, 0, 0);
    this.group.add(this.light);
    this.group.add(new THREE.AmbientLight('#8fa6c0', 0.12));
    // sky fill oriented to the landing site so slopes facing away from the sun aren't black
    const fill = new THREE.HemisphereLight('#bcd7e0', '#4a3024', 0.7);
    fill.position.copy(U);
    this.group.add(fill);

    const add = (b: Omit<Body, 'pos'>) => {
      const body: Body = { ...b, pos: new THREE.Vector3() };
      this.group.add(body.obj);
      body.label = this.makeLabel(b.name, b.sub);
      body.marker = markerSprite(b.parent === 'star' ? '#5ff3ff' : '#9fb7c4');
      this.group.add(body.marker);
      this.bodies.push(body);
      return body;
    };

    // Kindred's world: temperate, inner
    const inner = rockyPlanet(460, 3, ['#1f4e79', '#2f7d5b', '#6c8f4a', '#c9c3a0']);
    inner.add(buildAtmosphere(460 * 1.06, '#7fc4ff', 1.1));
    add({ name: 'INNER WORLD', sub: 'signal: none', obj: inner, radius: 460, orbit: 8200, period: 1500, phase: 1.2, parent: 'star' });
    // gas giant + moons
    const giantObj = gasGiant(2300);
    const giant = add({ name: 'GAS GIANT', sub: '2 moons', obj: giantObj, radius: 2300, orbit: 30000, period: 9000, phase: 2.6, parent: 'star' });
    add({ name: 'MOON G-I', sub: '', obj: rockyPlanet(190, 12, ['#5a5a62', '#8b8478', '#b9b2a6'], 6), radius: 190, orbit: 4600, period: 120, phase: 0.4, parent: giant });
    add({ name: 'MOON G-II', sub: '', obj: rockyPlanet(130, 13, ['#6b4c3b', '#a37c5a', '#d8c2a0'], 6), radius: 130, orbit: 6400, period: 200, phase: 2.0, parent: giant });
    // Engram's world: frozen, outer
    const outer = rockyPlanet(540, 21, ['#9fb6c8', '#d5e2ea', '#f4f8fb', '#7e93a6']);
    outer.add(buildAtmosphere(540 * 1.05, '#bfe4ff', 0.6));
    add({ name: 'OUTER ICE WORLD', sub: 'hostile to biology', obj: outer, radius: 540, orbit: 46000, period: 16000, phase: 4.1, parent: 'star' });
    // home moon
    add({ name: 'HOME MOON', sub: '', obj: rockyPlanet(115, 31, ['#4b4b52', '#77746f', '#a29d94'], 6), radius: 115, orbit: 2700, period: 400, phase: 0.9, parent: 'home' });

    this.homeLabel = this.makeLabel('HOME', 'landing site');
    this.homeMarker = markerSprite('#ffb547');
    this.group.add(this.homeMarker);

    // orbit rings (home included, drawn around the star)
    const ringMat = () => new THREE.LineBasicMaterial({ color: '#5ff3ff', transparent: true, opacity: 0, depthWrite: false, fog: false });
    const circle = (r: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat());
    };
    const homeRing = circle(HOME_ORBIT);
    this.star.add(homeRing);
    this.rings.push(homeRing);
    for (const b of this.bodies) {
      if (b.parent !== 'star') continue;
      const l = circle(b.orbit);
      this.star.add(l);
      this.rings.push(l);
    }

    // asteroid belt
    const rock = new THREE.IcosahedronGeometry(1, 0);
    this.belt = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ color: '#8a7f73', flatShading: true, roughness: 1 }), 1800);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < this.belt.count; i++) {
      const a = rnd() * Math.PI * 2, r = 20500 + rnd() * 4200;
      p.set(Math.cos(a) * r, (rnd() - 0.5) * 500, Math.sin(a) * r);
      q.setFromEuler(e.set(rnd() * 6, rnd() * 6, rnd() * 6));
      const s = 15 + rnd() ** 3 * 110;
      sc.set(s, s * (0.6 + rnd() * 0.5), s * (0.7 + rnd() * 0.4));
      this.belt.setMatrixAt(i, m.compose(p, q, sc));
    }
    this.star.add(this.belt);

    // background stars, re-centred on the camera every frame
    const sp = new Float32Array(5000 * 3);
    const sc2 = new Float32Array(5000 * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < 5000; i++) {
      p.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(900000);
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

  private makeLabel(name: string, sub: string) {
    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `${name}${sub ? `<small>${sub}</small>` : ''}`;
    el.style.opacity = '0';
    this.labelLayer.appendChild(el);
    return el;
  }

  /** `t` in seconds; `sys` 0..1 = how far into the system view the camera is. */
  update(t: number, camera: THREE.PerspectiveCamera, sys: number, surface: number, width: number, height: number) {
    const ha = HOME_PHASE + (t / HOME_PERIOD) * Math.PI * 2;
    // home orbits the star; we keep home at the origin, so the star sits at -homeOrbit
    this.starPos.set(-Math.cos(ha) * HOME_ORBIT, 0, -Math.sin(ha) * HOME_ORBIT);
    this.star.position.copy(this.starPos);
    this.light.position.copy(this.starPos);
    this.belt.rotation.y = t * 0.0006;

    for (const b of this.bodies) {
      const a = b.phase + (t / b.period) * Math.PI * 2;
      const c = b.parent === 'star' ? this.starPos : b.parent === 'home' ? new THREE.Vector3() : b.parent.pos;
      b.pos.set(c.x + Math.cos(a) * b.orbit, c.y, c.z + Math.sin(a) * b.orbit);
      b.obj.position.copy(b.pos);
      b.obj.rotation.y = t * 0.02;
      // screen-constant ring so tiny bodies stay findable from the system view
      const m = b.marker!;
      const k = smoothstep(0.1, 0.5, sys) * (b.parent === 'star' ? 1 : smoothstep(0.9, 0.55, sys));
      m.visible = k > 0.01;
      m.position.copy(b.pos);
      m.scale.setScalar(Math.max(b.radius * 2.6, camera.position.distanceTo(b.pos) * 0.028));
      (m.material as THREE.SpriteMaterial).opacity = k * 0.8;
    }

    const hk = smoothstep(0.1, 0.5, sys);
    this.homeMarker.visible = hk > 0.01;
    this.homeMarker.scale.setScalar(Math.max(1600, camera.position.length() * 0.028));
    (this.homeMarker.material as THREE.SpriteMaterial).opacity = hk * 0.9;

    for (const r of this.rings) {
      (r.material as THREE.LineBasicMaterial).opacity = 0.35 * sys;
      r.visible = sys > 0.01;
    }
    this.stars.position.copy(camera.position);
    (this.stars.material as THREE.PointsMaterial).opacity = 1 - surface * 0.92;

    // labels
    const show = smoothstep(0.15, 0.6, sys);
    const v = new THREE.Vector3();
    const place = (el: HTMLDivElement, p: THREE.Vector3, k: number) => {
      v.copy(p).project(camera);
      if (k < 0.02 || v.z > 1) { el.style.opacity = '0'; return; }
      el.style.opacity = String(k);
      el.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -140%)`;
      el.style.left = '0';
      el.style.top = '0';
    };
    for (const b of this.bodies) place(b.label!, b.pos, b.parent === 'star' ? show : show * 0.6 * smoothstep(0.85, 0.5, sys));
    place(this.homeLabel, new THREE.Vector3(), show);
  }
}
