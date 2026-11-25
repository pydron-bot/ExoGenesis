/**
 * The solar system around the home planet. The home planet is fixed at the
 * origin (floating origin), so the star and every other body move relative to
 * it. Distances are compressed for play, not to physical scale.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep } from './noise';
import type { BodyDef } from '../content/defs';
import { addRockyDetail, bodyUniforms, cloudShell, giantMaterial, lookOf, ringMaterial } from './body-surface';
import { CometLook } from './comet';
import { milkyWay, skyDome, skyGlow, starField } from './sky';
import { coronaMaterial, coronaRays, starMaterial, sunDim, sunNear, sunUniforms } from './sun';
import { R, U, bodyFlora, bodyHeight, bodyTerrain, buildAtmosphere, currentBody, terrainColorFor, type BodyTerrain } from './planet';

interface Body {
  id: string;
  name: string;
  sub: string;
  obj: THREE.Object3D;
  radius: number;
  orbit: number; // semi-major axis
  ecc: number;
  incl: number;
  period: number; // real seconds per orbit
  phase: number;
  /** The body it orbits (null = the star). */
  parent: Body | null;
  kind: 'planet' | 'moon' | 'comet';
  label?: HTMLDivElement;
  marker?: THREE.Sprite;
  comet?: CometLook;
  /** Position relative to the star. */
  abs: THREE.Vector3;
  /** Position in the scene (relative to the body being played, at the origin). */
  pos: THREE.Vector3;
  k?: number;
}

export const STAR_R = 5200;
const sunsetLight = new THREE.Color('#ffb070');

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

/** A rocky body from its terrain: the same height and colours as landing on it, smooth-shaded. */
function rockyBody(w: BodyTerrain, detail: number): THREE.Mesh {
  // big enough for the title tour's close-ups: a finer mesh so the silhouette stays round
  if (w.radius >= 600) detail = Math.max(detail, 18);
  // shared vertices, so the normals average across faces (smooth shading)
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const geo = mergeVertices(ico, 1e-6);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  const c = new THREE.Color();
  const color = terrainColorFor(w);
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const h = bodyHeight(d, w);
    color(h, bodyFlora(d, w), c);
    col.set([c.r, c.g, c.b], i * 3);
    const r = w.radius + Math.max(w.ocean ? 0 : 0.6, h);
    pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
}

/** Gas giant: a smooth sphere; its bands, storms and poles are drawn per pixel (body-surface.ts). */
function giant(radius: number, palette: string[], sd: number, ring?: RingLook, icy = false): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), giantMaterial(palette, sd, icy)));
  // a thin haze of the top band's colour, paled: a soft limb, and a glowing ring when backlit
  g.add(buildAtmosphere(radius * 1.02, new THREE.Color(palette[0]).lerp(new THREE.Color('#ffffff'), 0.65), 0.4));
  if (ring) g.add(ringMesh(radius, ring));
  return g;
}

interface RingLook { inner: number; outer: number; color: string; opacity: number; tilt: number; seed: number }
function ringMesh(radius: number, ring: RingLook) {
  const r = new THREE.Mesh(
    new THREE.RingGeometry(radius * ring.inner, radius * ring.outer, 128, 1),
    ringMaterial(ring.color, ring.opacity, radius * ring.inner, radius * ring.outer, ring.seed, radius),
  );
  r.rotation.x = -Math.PI / 2 + ring.tilt;
  return r;
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
  seed = Math.round(r0) % 2147483646 + 1;
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

/** A body as seen from elsewhere in the system (and in the editor's Worlds preview). */
export function buildBodyObject(id: string, d: BodyDef): THREE.Object3D {
  const ring = d.ring ? { inner: d.ringInner ?? 1.4, outer: d.ringOuter ?? 2.2, color: d.ringColor ?? '#d6c39c', opacity: d.ringOpacity ?? 0.4, tilt: THREE.MathUtils.degToRad(d.ringTilt ?? 24), seed: d.seed ?? 9 } : undefined;
  if (d.kind === 'giant') {
    const bands = (d.bands ?? []).map((b) => b.color).filter(Boolean);
    const pal = bands.length ? bands : ['#c99a6b', '#e6cfa6'];
    // a pale, blue-green palette reads as an ice giant: softer storms
    const icy = pal.every((c) => { const k = new THREE.Color(c); return k.b >= k.r; });
    return giant(d.radius, pal, d.seed ?? 9, ring, icy);
  }
  const w = bodyTerrain(id, d as unknown as Record<string, unknown>);
  const g = new THREE.Group();
  const rock = rockyBody(w, detailFor(d.radius));
  addRockyDetail(rock.material as THREE.MeshStandardMaterial, d, lookOf(d));
  g.add(rock);
  if (d.clouds) g.add(cloudShell(d.radius + Math.max(0, w.relief), d.seed ?? 7));
  if (d.atmosphere) g.add(buildAtmosphere(d.radius * 1.05, d.atmosphere, d.haze ?? 1));
  if (ring) g.add(ringMesh(d.radius, ring));
  return g;
}


/** How finely a far body is drawn: big bodies get more triangles. */
const detailFor = (r: number) => (r >= 2000 ? 16 : r >= 1000 ? 12 : r >= 500 ? 10 : r >= 200 ? 6 : 4);

export class SolarSystem {
  readonly starPos = new THREE.Vector3();
  /** Where the sun (and light) is drawn: follows the day near the surface. */
  readonly sunPos = new THREE.Vector3();
  readonly group = new THREE.Group();
  private bodies: Body[] = [];
  private star: THREE.Group;
  /** The star's soft halo: fades as the camera comes close, so its surface shows. */
  private starGlow: THREE.Sprite;
  /** The corona's streamers and prominences, up close. */
  private rays: THREE.Mesh;
  private light: THREE.PointLight;
  /** Ambient and sky fill (colony lights dim them at night). */
  ambient: THREE.AmbientLight;
  fill: THREE.HemisphereLight;
  private rings: { line: THREE.Line; body: Body | null; op: number }[] = [];
  private belts: THREE.InstancedMesh[] = [];
  private labelLayer: HTMLElement;
  private homeLabel: HTMLDivElement;
  private homeMarker: THREE.Sprite;
  private stars: THREE.Points;
  private milky: THREE.Mesh;
  /**
   * Set by the frame loop: how bright the sky is where the camera is (0 space or night .. 1 a daytime
   * sky), which hides the Milky Way; and the renderer's pixel ratio, for the stars' size.
   */
  skyDay = 0;
  pixelRatio = 1;
  /** Set by the frame loop: 0..1 how much air is round the camera, and how near sunrise or sunset it is (warms the light and the horizon). */
  skyAir = 0;
  golden = 0;
  /** Set by the frame loop: 0..1 cloud or dust cover overhead (weather): hides stars and the sun's glow, dims the sunlight. */
  overcast = 0;
  /** The landing site's up (for the horizon glow). */
  skyUp = new THREE.Vector3(0, 1, 0);
  private glow: THREE.Mesh;
  /** The sky's gradient and clouds (src/world/sky.ts skyDome). */
  private dome: THREE.Mesh;
  /** Set by the frame loop: the sky's colour at the horizon (the background), and whether this body has clouds. */
  skyBg = new THREE.Color();
  cloudy = true;
  /** Frames to draw the sky layers even in space (doing nothing), so their shaders compile before the descent needs them. */
  warmSky = 0;
  /** The body being played: at the origin, drawn by the globe (not here). */
  private here: Body;
  /**
   * 0..1: the title screen's camera is away visiting another body. Lights the scene from
   * the real star, keeps the stars bright and hides the map markers and orbit lines.
   */
  tour = 0;
  /** 0..1: the title's tour is at its system view: the orbit paths show faintly, though `tour` hides them otherwise. */
  overview = 0;
  /** The title tour's belt run: draw the asteroid belts though the camera is close (they're hidden below the system view). */
  beltsOn = false;
  /** The title tour is alongside this comet (its name): drawn in full, its tails at least 70% grown. */
  chase: string | null = null;

  /**
   * `defs`: content.bodies; `hereId`: the body the region being played is on.
   * Every other body is drawn here; the one being played is the scene's globe.
   */
  constructor(scene: THREE.Scene, labelLayer: HTMLElement, defs: Record<string, BodyDef> = {}, hereId = 'home') {
    this.labelLayer = labelLayer;
    scene.add(this.group);
    seed = 7;

    // star
    this.star = new THREE.Group();
    this.star.add(new THREE.Mesh(new THREE.SphereGeometry(STAR_R, 64, 48), starMaterial()));
    const corona = new THREE.Mesh(new THREE.SphereGeometry(STAR_R * 1.3, 64, 48), coronaMaterial());
    corona.renderOrder = 1;
    this.star.add(corona);
    this.rays = coronaRays(STAR_R);
    this.star.add(this.rays);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    glow.scale.setScalar(STAR_R * 10);
    this.star.add(glow);
    this.starGlow = glow;
    this.group.add(this.star);
    this.light = new THREE.PointLight('#fff4e4', 3.2, 0, 0);
    this.group.add(this.light);
    this.ambient = new THREE.AmbientLight('#8fa6c0', 0.12);
    this.group.add(this.ambient);
    // sky fill oriented to the landing site so slopes facing away from the sun aren't black
    const fill = this.fill = new THREE.HemisphereLight('#bcd7e0', '#4a3024', 0.7);
    fill.position.copy(U);
    this.group.add(fill);

    // the bodies, parents before their moons
    if (!defs[hereId]) defs = { ...defs, [hereId]: { name: currentBody().name.toUpperCase(), kind: 'planet', radius: R, orbit: 75000, period: 3600 } as BodyDef };
    const made = new Map<string, Body>();
    const make = (id: string, depth = 0): Body | null => {
      if (made.has(id)) return made.get(id)!;
      const d = defs[id];
      if (!d || depth > 12) return null;
      const parent = d.parent && defs[d.parent] && d.parent !== id ? make(d.parent, depth + 1) : null;
      const kind: Body['kind'] = d.kind === 'comet' ? 'comet' : parent ? 'moon' : 'planet';
      const here = id === hereId;
      const b: Body = {
        id, name: d.name, sub: d.sub ?? '', obj: here ? new THREE.Group() : buildBodyObject(id, d),
        radius: d.radius, orbit: d.orbit, ecc: d.ecc ?? 0, incl: THREE.MathUtils.degToRad(d.incl ?? 0), period: d.period,
        phase: THREE.MathUtils.degToRad(d.phase ?? 0), parent, kind, abs: new THREE.Vector3(), pos: new THREE.Vector3(),
      };
      made.set(id, b);
      this.bodies.push(b);
      if (here) return b;
      this.group.add(b.obj);
      b.label = this.makeLabel(b.name, b.sub, kind);
      b.marker = markerSprite(kind === 'planet' ? '#5ff3ff' : kind === 'comet' ? '#c8f0ff' : '#9fb7c4');
      this.group.add(b.marker);
      if (d.kind === 'comet') {
        b.comet = new CometLook(d.radius);
        this.group.add(b.comet.group);
      }
      return b;
    };
    for (const id of Object.keys(defs).sort()) make(id);
    this.here = made.get(hereId)!;

    // belts: decoration, their own random sequence
    const main = belt(3200, 122000, 148000, 2500, [60, 520], '#8a7f73');
    this.star.add(main);
    this.belts.push(main);
    const kuiper = belt(1600, 430000, 490000, 9000, [120, 900], '#a9b9c4');
    this.star.add(kuiper);
    this.belts.push(kuiper);

    const hd = defs[hereId];
    this.homeLabel = this.makeLabel(hd.name, 'landing site', 'planet');
    this.homeMarker = markerSprite('#ffb547');
    this.group.add(this.homeMarker);

    // orbit paths round the star (the body being played's included); moons' round their planet when it's this one
    const ringMat = (op: number) => new THREE.LineBasicMaterial({ color: '#5ff3ff', transparent: true, opacity: op, depthWrite: false, fog: false });
    const path = (a: number, e: number, incl: number, op = 0.35) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 384; i++) {
        const th = (i / 384) * Math.PI * 2;
        const r = (a * (1 - e * e)) / (1 + e * Math.cos(th));
        pts.push(new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r * Math.sin(incl), Math.sin(th) * r * Math.cos(incl)));
      }
      return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat(op));
    };
    for (const b of this.bodies) {
      if (b.parent) continue;
      const op = b.kind === 'comet' ? 0.15 : 0.35;
      const line = path(b.orbit, b.ecc, b.incl, op);
      this.star.add(line);
      this.rings.push({ line, body: null, op });
    }

    // background stars and the Milky Way, re-centred on the camera every frame (src/world/sky.ts)
    this.stars = starField(rnd);
    this.milky = milkyWay();
    scene.add(this.milky);
    this.glow = skyGlow();
    scene.add(this.glow);
    this.dome = skyDome();
    scene.add(this.dome);
    // stars first: the sky's clouds draw over them
    this.stars.renderOrder = -3;
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

  /** Distance from the star to the body being played, now. */
  get starDist() { return this.starPos.length(); }
  /** The sunlight's colour now (warmer low in the sky). */
  get sunColor() { return this.light.color; }
  /** The sunlight's full intensity now (before any handoff). */
  sunIntensity = 3.2;
  private sunHandoff = 0;
  /** Give `k` (0..1) of the sunlight to the up-close shadow-casting light (src/world/sunshadow.ts): this one keeps the rest. */
  handoff(k: number) {
    this.sunHandoff = k;
    this.light.intensity = this.sunIntensity * (1 - k);
  }

  /**
   * `t` in seconds; `sys` 0..1 = how far into the system view the camera is.
   * `sunAngle` (optional): where the planet's day puts the sun, as an angle in
   * the xz-plane. Near the surface the sun and light follow it (so day/night
   * matches the sim's clock); in the system view the star sits at its orbit.
   */
  /** Where a body is drawn now (world space; null for the one being played or one not in the system). Cinematics look up at it. */
  bodyPos(id: string): THREE.Vector3 | null {
    const b = this.bodies.find((x) => x.id === id);
    return b && b !== this.here ? b.pos : null;
  }

  /** How far the planets' orbits reach from the star (their farthest points; comets left out): the title's system view frames it. */
  extent(): number {
    let r = 0;
    for (const b of this.bodies) if (!b.parent && b.kind !== 'comet') r = Math.max(r, b.orbit * (1 + b.ecc));
    return r || 1e5;
  }

  /**
   * The title tour's special stops: the star, the comets (to chase), the ringed giants (to skim their rings, with the
   * ring plane's normal) and the main asteroid belt (its middle radius, round the star).
   */
  scenic() {
    const ringed: { name: string; radius: number; pos: THREE.Vector3; normal: (out: THREE.Vector3) => THREE.Vector3 }[] = [];
    for (const b of this.bodies) {
      if (b === this.here || b.kind === 'comet') continue;
      const ring = b.obj.children.find((c) => (c as THREE.Mesh).geometry?.type === 'RingGeometry');
      if (ring) ringed.push({ name: b.name, radius: b.radius, pos: b.pos, normal: (out) => { ring.updateWorldMatrix(true, false); return out.set(0, 0, 1).transformDirection(ring.matrixWorld); } });
    }
    return {
      star: { radius: STAR_R, pos: this.starPos },
      comets: this.bodies.filter((b) => b.kind === 'comet').map((b) => ({ name: b.name, radius: b.radius, pos: b.pos })),
      ringed,
      belt: 135000,
    };
  }

  /** Bodies worth a close look (the title screen's tour): planets and the bigger moons. */
  tourStops(): { name: string; sub: string; radius: number; pos: THREE.Vector3 }[] {
    return this.bodies.filter((b) => b !== this.here && b.kind !== 'comet' && b.radius >= 600);
  }

  /** Big round things that can hide the sun (the lens flare's test): the globe being played and every planet and moon. */
  occluders(globeR: number): { pos: THREE.Vector3; radius: number }[] {
    const out = [{ pos: this.here.pos, radius: globeR }];
    for (const b of this.bodies) if (b !== this.here && b.kind !== 'comet') out.push({ pos: b.pos, radius: b.radius });
    return out;
  }

  update(t: number, camera: THREE.PerspectiveCamera, sys: number, surface: number, width: number, height: number, sunAngle?: number) {
    const away = this.tour;
    surface *= 1 - away;
    bodyUniforms.uBodyTime.value = t;
    // positions round the star (parents first: `bodies` is in that order), then shift so this body is the origin
    const zero = new THREE.Vector3();
    for (const b of this.bodies) this.orbitPos(b, t, b.parent ? b.parent.abs : zero, b.abs);
    const off = this.here.abs;
    this.starPos.copy(off).negate();
    const sunDist = Math.max(1000, this.starPos.length());
    if (sunAngle === undefined) this.sunPos.copy(this.starPos);
    else this.sunPos.set(Math.cos(sunAngle) * sunDist, 0, Math.sin(sunAngle) * sunDist).lerp(this.starPos, Math.max(away, smoothstep(0.05, 0.5, sys)));
    this.star.position.copy(this.sunPos);
    sunUniforms.uSunPos.value.copy(this.sunPos);
    const starD = camera.position.distanceTo(this.sunPos);
    (this.starGlow.material as THREE.SpriteMaterial).opacity = smoothstep(STAR_R * 2.5, STAR_R * 9, starD);
    sunNear.value = 1 - smoothstep(STAR_R * 6, STAR_R * 22, starD);
    this.rays.visible = sunNear.value > 0.01;
    this.light.position.copy(this.sunPos);
    this.belts[0].rotation.y = t * 0.0004;
    this.belts[1].rotation.y = t * 0.00008;
    // belts are sub-pixel specks until the system view; skip ~5k rocks' worth of triangles below it
    for (const b of this.belts) b.visible = sys > 0.02 || this.beltsOn;
    // the star (and with it belts and orbit paths) is drawn at the sun's place; keep paths centred on the real star
    const shift = new THREE.Vector3().subVectors(this.starPos, this.sunPos);

    const v = new THREE.Vector3();
    const hereR = this.here.radius;
    for (const b of this.bodies) {
      b.pos.subVectors(b.abs, off);
      if (b === this.here) continue;
      b.obj.position.copy(b.pos);
      b.obj.rotation.y = t * 0.02;
      const camD = camera.position.distanceTo(b.pos);
      // screen-constant ring so small bodies stay findable from far away
      let k: number;
      if (b.kind === 'moon' && b.parent) {
        const pd = camera.position.distanceTo(b.parent.pos);
        const pr = b.parent === this.here ? hereR : b.parent.radius;
        k = smoothstep(pr * 25, pr * 10, pd) * smoothstep(b.radius * 6, b.radius * 30, camD) * (1 - surface);
      } else {
        k = smoothstep(0.1, 0.5, sys);
      }
      k *= 1 - away;
      const m = b.marker!;
      m.visible = k > 0.01;
      m.position.copy(b.pos);
      m.scale.setScalar(Math.max(b.radius * 2.6, camD * (b.kind === 'planet' ? 0.028 : 0.018)));
      (m.material as THREE.SpriteMaterial).opacity = k * 0.8;
      b.k = k;
      if (b.comet) {
        // which way it's moving (a few seconds on along its orbit), for the dust tail's sweep
        const vel = this.orbitPos(b, t + 5, b.parent ? b.parent.abs : zero, v).sub(b.abs).normalize();
        // seen from the system view (and faintly from orbit, if it's close)
        const chased = this.chase === b.name;
        b.comet.boost += ((chased ? 0.7 : 0) - b.comet.boost) * 0.02;
        b.comet.update(b.pos, this.starPos, vel, camera, Math.max(Math.max(smoothstep(0.02, 0.4, sys), 0.35 * (1 - surface)) * (1 - away), chased || b.comet.boost > 0.01 ? 1 : 0), t);
      }
    }

    for (const r of this.rings) {
      const show = Math.max(sys * (1 - away), this.overview * 0.55);
      (r.line.material as THREE.LineBasicMaterial).opacity = r.op * show;
      r.line.visible = show > 0.01;
      r.line.position.copy(shift);
    }
    for (const b of this.belts) b.position.copy(shift);
    const hk = smoothstep(0.1, 0.5, sys) * (1 - away);
    this.homeMarker.visible = hk > 0.01;
    this.homeMarker.scale.setScalar(Math.max(hereR * 2.6, camera.position.length() * 0.028));
    (this.homeMarker.material as THREE.SpriteMaterial).opacity = hk * 0.9;
    this.stars.position.copy(camera.position);
    this.milky.position.copy(camera.position);
    const su = (this.stars.material as THREE.ShaderMaterial).uniforms;
    su.uOpacity.value = (1 - surface * 0.92 * this.skyDay) * (1 - this.overcast * 0.95);
    su.uTime.value = t;
    // they twinkle seen through air, from near the ground
    su.uTwinkle.value = surface;
    su.uScale.value = 1.5 * this.pixelRatio;
    (this.milky.material as THREE.ShaderMaterial).uniforms.uFade.value = (1 - this.skyDay) * (1 - this.overcast);
    // the air's glow round the sun and along the horizon at sunrise and sunset
    const skyWarm = this.warmSky > 0;
    if (skyWarm) this.warmSky--;
    this.glow.visible = this.skyAir > 0.01 || skyWarm;
    this.glow.position.copy(camera.position);
    const gu = (this.glow.material as THREE.ShaderMaterial).uniforms;
    gu.uSun.value.subVectors(this.sunPos, camera.position).normalize();
    gu.uUp.value.copy(this.skyUp);
    gu.uGolden.value = this.golden;
    gu.uAir.value = this.skyAir * (1 - this.overcast * 0.8);
    gu.uDay.value = this.skyDay;
    this.dome.visible = this.skyAir > 0.01 || skyWarm;
    this.dome.position.copy(camera.position);
    const du = (this.dome.material as THREE.ShaderMaterial).uniforms;
    du.uSun.value.copy(gu.uSun.value);
    du.uUp.value.copy(this.skyUp);
    du.uBg.value.copy(this.skyBg);
    du.uAir.value = this.skyAir;
    du.uDay.value = this.skyDay;
    du.uGolden.value = this.golden;
    du.uOvercast.value = this.overcast;
    du.uTime.value = t;
    du.uCloudy.value = this.cloudy ? 1 : 0;
    // warmer, a little dimmer sunlight low in the sky
    this.light.color.set('#fff4e4').lerp(sunsetLight, this.golden * this.skyAir * 0.6);
    this.sunIntensity = 3.2 * (1 - this.overcast * 0.6);
    this.light.intensity = this.sunIntensity * (1 - this.sunHandoff);
    sunDim.value = 1 - this.overcast * 0.75;
    (this.starGlow.material as THREE.SpriteMaterial).opacity *= 1 - this.overcast * 0.8;

    // labels
    const place = (el: HTMLDivElement, p: THREE.Vector3, k: number) => {
      v.copy(p).project(camera);
      if (k < 0.02 || v.z > 1) { el.style.opacity = '0'; return; }
      el.style.opacity = String(k);
      el.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -140%)`;
    };
    for (const b of this.bodies) if (b !== this.here) place(b.label!, b.pos, b.k ?? 0);
    place(this.homeLabel, zero, hk);
  }
}
