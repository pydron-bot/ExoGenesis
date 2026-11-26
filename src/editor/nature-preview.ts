/**
 * Nature (Biomes, Wildlife): a little patch of ground showing the record as the
 * game builds it. A biome shows one plant of each form in its colours and its
 * wildlife walking round; a species shows itself at its smallest and largest
 * beside a grazer for scale. Day / night shows the glow. Redraws as the form changes.
 */
import * as THREE from 'three';
import type { AssetDef, BiomeDef, WildlifeDef } from '../content/defs';
import { loadModel } from '../assets/models';
import { recolorModel, type Slots } from '../world/recolor';
import { ARCHETYPES, Mesher, floraMaterial, floraUniforms, mulberry, palette } from '../world/flora';
import { buildCreatureLook, creatureMaterial } from '../world/fauna-models';
import { h } from './dom';

let renderer: THREE.WebGLRenderer | null = null;

export interface NatureSource {
  kind: 'biomes' | 'wildlife';
  draft(): BiomeDef | WildlifeDef;
  wildlife(): Record<string, WildlifeDef>;
  /** Model assets, to draw records that name one. */
  asset(id: string): AssetDef | undefined;
}


interface Walker { obj: THREE.Mesh; r: number; speed: number; a: number; flyer: boolean; height: number; hop: boolean; sx: number }

export class NaturePreview {
  readonly el: HTMLElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  private group = new THREE.Group();
  private view: HTMLElement;
  private info: HTMLElement;
  private raf = 0;
  private key = '';
  private yaw = 0.7;
  private night = false;
  private disposed = false;
  private walkers: Walker[] = [];
  private sun = new THREE.DirectionalLight('#fff1dc', 2.4);
  private amb = new THREE.HemisphereLight('#bcd4e6', '#3a3028', 0.9);
  private seed = 1;
  private t0 = performance.now();

  constructor(private src: NatureSource) {
    renderer ??= new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.view = h('div', 'wp-view');
    this.info = h('div', 'wp-info');
    const dayBtn = h('button', '', 'Night');
    dayBtn.onclick = () => { this.night = !this.night; dayBtn.textContent = this.night ? 'Day' : 'Night'; };
    const reroll = h('button', '', 'Another roll');
    reroll.title = 'Build the plants from another seed';
    reroll.onclick = () => { this.seed++; this.key = ''; this.refresh(); };
    this.el = h('div', 'world-pv nature-pv', this.view, h('div', 'wp-regions', dayBtn, reroll), this.info);
    this.sun.position.set(-20, 30, 15);
    this.scene.add(this.sun, this.amb, this.group);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(26, 48), new THREE.MeshStandardMaterial({ color: '#5a4a3e', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    let drag: number | null = null;
    this.view.onpointerdown = (e) => { drag = e.clientX; this.view.setPointerCapture(e.pointerId); };
    this.view.onpointermove = (e) => { if (drag !== null) { this.yaw -= (e.clientX - drag) * 0.008; drag = e.clientX; } };
    this.view.onpointerup = () => { drag = null; };
    this.view.title = 'Drag to turn';
    this.refresh();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  refresh() {
    const d = this.src.draft();
    if (!d) return;
    const key = JSON.stringify(d) + this.seed + JSON.stringify(this.src.wildlife());
    if (key === this.key) return;
    this.key = key;
    for (const o of [...this.group.children]) { this.group.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    this.walkers = [];
    if (this.src.kind === 'biomes') this.buildBiome(d as BiomeDef);
    else this.buildSpecies(d as WildlifeDef);
  }

  private buildBiome(b: BiomeDef) {
    const forms = (b.plants ?? []).filter((p) => ARCHETYPES.some((a) => a.name === p.plant));
    const mat = floraMaterial(true);
    const r = mulberry(this.seed * 977);
    forms.forEach((p, i) => {
      const arch = ARCHETYPES.find((a) => a.name === p.plant)!;
      const m = new Mesher();
      const pal = palette(r, b);
      arch.build(mulberry(this.seed * 131 + i * 31), pal, m);
      const mesh = new THREE.Mesh(m.build(false), mat);
      this.useModel(mesh, p.model, { stem: { color: pal.base }, tip: { color: pal.tip }, leaf: { color: pal.tip.clone().lerp(pal.base, 0.2) }, glow: { color: pal.glow, glow: 1 } });
      const a = (i / Math.max(1, forms.length)) * Math.PI * 2;
      const rad = arch.big ? 13 : 7;
      mesh.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      mesh.scale.setScalar(b.size ?? 1);
      this.group.add(mesh);
    });
    const all = this.src.wildlife();
    const species = (b.wildlife ?? []).map((w) => all[w.species]).filter(Boolean);
    species.forEach((w, i) => this.addWalker(w, 3 + i * 3.2, i));
    const glow = b.glow ?? 1;
    this.info.textContent = `${forms.length} plant form${forms.length === 1 ? '' : 's'} (a region grows those its Chance rolls, plus ${b.extra ?? 1} look-alike${(b.extra ?? 1) === 1 ? '' : 's'}), ${species.length} wildlife species. Density ×${b.density ?? 1}, size ×${b.size ?? 1}, glow ×${glow}. The plants here are one roll; every region seed builds its own.`;
  }

  private buildSpecies(w: WildlifeDef) {
    const big = w.sizeMax ?? w.size;
    this.addStatic(w, w.size, -2 - w.size * 1.2);
    if (big !== w.size) this.addStatic(w, big, 2 + big * 1.2);
    const grazer = this.src.wildlife().grazer;
    if (grazer) {
      const g = this.addStatic(grazer, 1, 0);
      g.position.set(0, 0, -6 - Math.max(w.size, big) * 1.2);
    }
    this.addWalker(w, 12, 0);
    const beh: Record<string, string> = {
      herd: 'wanders with its herd, bolts from anything within its wariness',
      skittish: 'darts about in short dashes, pausing between; flees from far off',
      lumber: 'plods slowly; stops and stares at what comes close',
      flyer: `circles ${w.height ?? 10} u over its herd's ground; scatters wider when disturbed`,
      burrow: 'creeps about, ducks underground when something comes close',
    };
    this.info.textContent = `${w.name || 'This species'} ${beh[w.behavior] ?? ''}. Size ${w.size}${big !== w.size ? `–${big}` : ''} × a grazer (shown behind). Walk ${w.speed ?? 2.2} u/s, run ${w.run ?? 7.5} u/s, wariness ${w.flee ?? 14} u, herds ×${w.herdScale ?? 1}.`;
  }

  private addStatic(w: WildlifeDef, size: number, x: number) {
    const mesh = new THREE.Mesh(buildCreatureLook(w), creatureMaterial());
    this.useModel(mesh, w.model, this.wildSlots(w));
    mesh.scale.setScalar(size);
    mesh.position.set(x, w.behavior === 'flyer' ? 2 : 0, 0);
    mesh.rotation.y = 0.6;
    this.group.add(mesh);
    return mesh;
  }

  private addWalker(w: WildlifeDef, r: number, i: number) {
    const mesh = new THREE.Mesh(buildCreatureLook(w), creatureMaterial());
    this.useModel(mesh, w.model, this.wildSlots(w));
    const s = (w.size + (w.sizeMax ?? w.size)) / 2;
    mesh.scale.setScalar(s);
    this.group.add(mesh);
    this.walkers.push({ obj: mesh, r, speed: (w.speed ?? 2.2) / r, a: i * 2.1, flyer: w.behavior === 'flyer', height: Math.min(12, w.height ?? 10), hop: w.body === 'hopper', sx: s });
  }

  /** Swap a mesh's built-in shape for a model in the given colours once it loads (if the record still shows). */
  private useModel(mesh: THREE.Mesh, id: string | undefined, slots: Slots) {
    const a = id ? this.src.asset(id) : undefined;
    if (!a) return;
    const key = this.key;
    loadModel(a).then((root) => {
      if (this.key !== key || this.disposed) return;
      const old = mesh.geometry;
      mesh.geometry = recolorModel(root, slots);
      old.dispose();
    }, (e) => console.warn(`${id} failed to load`, e));
  }

  private wildSlots(w: WildlifeDef): Slots {
    return { color: { color: new THREE.Color(w.color) }, accent: { color: new THREE.Color(w.accent) }, glow: { color: new THREE.Color(w.glow || w.accent), glow: w.glow ? 1 : 0 } };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }

  private render() {
    if (!renderer) return;
    const t = (performance.now() - this.t0) / 1000;
    for (const w of this.walkers) {
      const a = w.a + t * w.speed;
      const y = w.flyer ? w.height + Math.sin(t + w.a) * 0.6 : w.hop ? Math.abs(Math.sin(t * 7 + w.a)) * 0.5 * w.sx : 0;
      w.obj.position.set(Math.cos(a) * w.r, y, Math.sin(a) * w.r);
      w.obj.rotation.y = -a; // facing along the circle
      if (w.flyer) w.obj.scale.x = w.sx * (1 + Math.sin(t * 5 + w.a) * 0.28);
    }
    floraUniforms.uTime.value = t;
    floraUniforms.uGlow.value = this.night ? 1.78 : 0.18;
    this.sun.intensity = this.night ? 0.15 : 2.4;
    this.amb.intensity = this.night ? 0.12 : 0.9;
    this.scene.background = new THREE.Color(this.night ? '#05070d' : '#8fb0ad');
    const w = Math.max(200, this.view.clientWidth), hh = Math.round(Math.min(380, w * 0.6));
    this.view.style.height = `${hh}px`;
    if (renderer.domElement.parentElement !== this.view) this.view.append(renderer.domElement);
    renderer.setSize(w, hh);
    this.camera.aspect = w / hh;
    this.camera.position.set(Math.sin(this.yaw) * 30, 17, Math.cos(this.yaw) * 30);
    this.camera.lookAt(0, 2.5, 0);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}
