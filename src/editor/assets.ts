/**
 * Asset browser: library grid, model/image/audio previews, upload and replace.
 *
 * File assets are a record in content/assets/<id>.json plus a file in
 * public/media/<kind>/<id>.<ext>. Built-in procedural models are listed too
 * (read-only, exportable to .glb).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { BUILTINS, builtinById, type Builtin } from '../assets/builtin';
import { applyImport, forgetModel, loadModel, modelStats } from '../assets/models';
import { ASSET_EXT, ASSET_KINDS, ID_RE, mediaUrl, type AssetDef, type AssetKind } from '../content/defs';

export interface MediaInfo { hash: string; bytes: number }
export interface Usage { coll: 'units' | 'buildings' | 'sound'; id: string; name: string }

export interface AssetHost {
  /** Asset records currently on disk. */
  records(): { id: string; data: AssetDef }[];
  media(): Map<string, MediaInfo>;
  /** Records whose `model` points at this asset. */
  usedBy(assetId: string): Usage[];
  /** Record using this built-in (no model set), and the asset replacing it if any. */
  builtinUse(b: Builtin): { user?: Usage; replacedBy?: string };
  openRecord(coll: 'assets' | 'units' | 'buildings' | 'sound', id: string): void;
  openBuiltin(id: string): void;
  api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T>;
  toast(msg: string, bad?: boolean): void;
  /** Re-read files + media from the dev server. */
  refresh(): Promise<void>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null)[]) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
};
const button = (label: string, onclick: () => void, cls = '') => { const b = el('button', cls, label); b.onclick = onclick; return b; };
const fmtBytes = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const kindOfExt = (ext: string): AssetKind | null => (ASSET_KINDS.find((k) => ASSET_EXT[k].includes(ext)) ?? null);
const urlOf = (a: AssetDef, media: Map<string, MediaInfo>) => {
  const m = media.get(`${a.kind}/${a.file}`);
  return m ? `${mediaUrl(a)}?v=${m.hash.slice(0, 10)}` : null;
};

// ---------- rendering: one viewer renderer + one thumbnail renderer for the editor's lifetime ----------
let viewRenderer: THREE.WebGLRenderer | null = null;
let thumbRenderer: THREE.WebGLRenderer | null = null;
const thumbCache = new Map<string, string>();

function stage(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a1018');
  scene.add(new THREE.HemisphereLight('#d8ecff', '#3a2a20', 1.3));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
  sun.position.set(5, 9, 6);
  scene.add(sun);
  const back = new THREE.DirectionalLight('#7fb6ff', 0.8);
  back.position.set(-6, 4, -8);
  scene.add(back);
  return scene;
}

/** Camera position that frames `obj` from the front-right, a little above. */
function frame(obj: THREE.Object3D, cam: THREE.PerspectiveCamera, target?: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(0.5, box.getSize(new THREE.Vector3()).length() / 2);
  const d = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.05;
  cam.position.copy(c).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(d));
  cam.near = d / 100;
  cam.far = d * 20;
  cam.updateProjectionMatrix();
  cam.lookAt(c);
  target?.copy(c);
}

function thumbOf(key: string, obj: THREE.Object3D): string {
  const hit = thumbCache.get(key);
  if (hit) return hit;
  thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  thumbRenderer.setPixelRatio(1);
  thumbRenderer.setSize(240, 180, false);
  const scene = stage();
  scene.add(obj);
  const cam = new THREE.PerspectiveCamera(35, 240 / 180, 0.01, 1000);
  frame(obj, cam);
  thumbRenderer.render(scene, cam);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  thumbCache.set(key, url);
  return url;
}

async function waveform(url: string, canvas: HTMLCanvasElement): Promise<AudioBuffer | null> {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const ac = new OfflineAudioContext(1, 1, 44100);
    const audio = await ac.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const g = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height, step = Math.max(1, Math.floor(data.length / w));
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#3fd6ff';
    for (let x = 0; x < w; x++) {
      let lo = 1, hi = -1;
      for (let i = x * step; i < Math.min(data.length, (x + 1) * step); i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      g.fillRect(x, ((1 - hi) / 2) * h, 1, Math.max(1, ((hi - lo) / 2) * h));
    }
    return audio;
  } catch { return null; }
}

/** Interactive model viewer with ground grid, +Z arrow and an optional comparison model. */
class Viewer {
  readonly wrap = el('div', 'viewer');
  private scene = stage();
  private cam = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  private controls: OrbitControls;
  private holder = new THREE.Group();
  private refHolder = new THREE.Group();
  private grid: THREE.GridHelper;
  private raf = 0;
  private ro: ResizeObserver;

  constructor() {
    viewRenderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    viewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.wrap.append(viewRenderer.domElement);
    this.controls = new OrbitControls(this.cam, viewRenderer.domElement);
    this.controls.enableDamping = true;
    this.grid = new THREE.GridHelper(40, 40, '#3a5a74', '#1a2a3a');
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.02, 0), 2, '#ffb547', 0.5, 0.3);
    arrow.name = 'front';
    this.scene.add(this.grid, arrow, this.holder, this.refHolder);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); viewRenderer!.render(this.scene, this.cam); };
    loop();
  }
  set(obj: THREE.Object3D | null, reframe = true) {
    this.holder.clear();
    if (obj) this.holder.add(obj);
    if (reframe) this.reframe();
  }
  setReference(obj: THREE.Object3D | null, reframe = true) {
    this.refHolder.clear();
    if (obj) {
      // stand the reference to the left of the model, ghosted
      const mb = new THREE.Box3().setFromObject(this.holder), rb = new THREE.Box3().setFromObject(obj);
      const gap = Math.max(0.5, (mb.isEmpty() ? 1 : mb.getSize(new THREE.Vector3()).x) * 0.25);
      obj.position.x += (mb.isEmpty() ? 0 : mb.min.x) - gap - rb.max.x;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: '#7fd3ff', transparent: true, opacity: 0.35, depthWrite: false, flatShading: true });
      });
      this.refHolder.add(obj);
    }
    if (reframe) this.reframe();
  }
  reframe() {
    const all = new THREE.Group();
    const box = new THREE.Box3().setFromObject(this.holder).union(new THREE.Box3().setFromObject(this.refHolder));
    if (!box.isEmpty()) {
      const s = box.getSize(new THREE.Vector3());
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z));
      box.getCenter(m.position);
      all.add(m);
      const size = Math.max(4, Math.ceil(Math.max(s.x, s.z) * 2.5));
      this.grid.scale.setScalar(size / 40);
    }
    frame(all, this.cam, this.controls.target);
  }
  snapshot(): string { viewRenderer!.render(this.scene, this.cam); return viewRenderer!.domElement.toDataURL('image/png'); }
  private resize() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    viewRenderer!.setSize(w, h);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    viewRenderer?.domElement.remove();
  }
}

async function exportGlb(obj: THREE.Object3D, name: string) {
  const data = await new GLTFExporter().parseAsync(obj, { binary: true });
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }));
  a.download = `${name}.glb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- upload ----------
const slug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'asset';
const titleOf = (s: string) => s.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim();

/** Add files to the library: write each file, then its record. Returns the new ids. */
export async function uploadFiles(host: AssetHost, files: File[]): Promise<string[]> {
  const taken = new Set(host.records().map((r) => r.id));
  const made: string[] = [];
  for (const f of files) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const kind = kindOfExt(ext);
    if (!kind) { host.toast(`${f.name}: not a supported file (${Object.values(ASSET_EXT).flat().map((e) => '.' + e).join(' ')})`, true); continue; }
    let id = slug(f.name);
    if (!ID_RE.test(id)) id = `asset-${id}`;
    for (let n = 2; taken.has(id) || host.media().has(`${kind}/${id}.${ext}`); n++) id = `${slug(f.name)}-${n}`;
    taken.add(id);
    try {
      await host.api('PUT', `/__content/media?path=${encodeURIComponent(`${kind}/${id}.${ext}`)}`, f);
      const rec: AssetDef = { name: titleOf(f.name), kind, file: `${id}.${ext}`, source: kind === 'model' ? 'blender' : 'other', scale: 1, yaw: 0, lift: 0 };
      await host.api('PUT', '/__content/file', { path: `assets/${id}.json`, text: JSON.stringify(rec, null, 2) + '\n', baseHash: null });
      made.push(id);
    } catch (e) {
      host.toast(`${f.name}: ${(e as Error).message}`, true);
    }
  }
  await host.refresh();
  if (made.length) host.toast(`Added ${made.length} asset${made.length > 1 ? 's' : ''}`);
  return made;
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((res) => {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => res([...(inp.files ?? [])]);
    inp.click();
  });
}
export const ACCEPT_ALL = Object.values(ASSET_EXT).flat().map((e) => '.' + e).join(',');

// ---------- library ----------
type Filter = 'all' | AssetKind | 'builtin';
let libFilter: Filter = 'all';
let libSearch = '';

export function renderLibrary(main: HTMLElement, aside: HTMLElement, host: AssetHost) {
  const media = host.media();
  const head = el('div', 'head', el('div', '', el('h1', '', 'Asset library'), el('div', 'path', 'public/media/ + content/assets/')));
  const up = button('Upload files…', async () => uploadFiles(host, await pickFiles(ACCEPT_ALL, true)), 'primary');
  head.append(el('div', 'actions', up));
  const chips = el('div', 'chips');
  const search = el('input', 'search');
  search.placeholder = 'Search';
  search.value = libSearch;
  const grid = el('div', 'asset-grid');
  const counts: Record<Filter, number> = { all: 0, model: 0, image: 0, audio: 0, builtin: BUILTINS.length };
  const recs = host.records();
  for (const r of recs) { counts.all++; counts[r.data.kind]++; }
  counts.all += BUILTINS.length;
  for (const f of ['all', 'model', 'image', 'audio', 'builtin'] as Filter[]) {
    const label = { all: 'All', model: 'Models', image: 'Images', audio: 'Audio', builtin: 'Built-in' }[f];
    const c = button(`${label} ${counts[f]}`, () => { libFilter = f; renderLibrary(main, aside, host); }, libFilter === f ? 'chip on' : 'chip');
    chips.append(c);
  }
  search.oninput = () => { libSearch = search.value; fill(); };
  chips.append(search);

  const fill = () => {
    grid.replaceChildren();
    const q = libSearch.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    if (libFilter !== 'builtin') {
      for (const r of recs) {
        if (libFilter !== 'all' && r.data.kind !== libFilter) continue;
        if (!match(`${r.data.name} ${r.id} ${r.data.kind} ${r.data.source} ${r.data.credit ?? ''}`)) continue;
        grid.append(fileCard(r.id, r.data));
      }
    }
    if (libFilter === 'all' || libFilter === 'builtin' || libFilter === 'model') {
      for (const b of BUILTINS) if (match(`${b.name} ${b.group} procedural built-in`)) grid.append(builtinCard(b));
    }
    if (!grid.children.length) grid.append(el('div', 'empty-note', q ? 'Nothing matches.' : 'Nothing here yet. Drop files onto this page to add them.'));
  };

  const card = (title: string, sub: string, badge: string, thumb: HTMLElement, onclick: () => void, warn = false) => {
    const c = el('button', warn ? 'asset-card warn' : 'asset-card', el('div', 'thumb', thumb), el('div', 'meta', el('span', 'name', title), el('span', 'badge', badge)), el('small', '', sub));
    c.onclick = onclick;
    return c;
  };
  function fileCard(id: string, a: AssetDef) {
    const url = urlOf(a, media);
    const used = host.usedBy(id);
    const sub = `${a.source}${used.length ? ` · used by ${used.map((u) => u.name).join(', ')}` : ' · unused'}`;
    let thumb: HTMLElement;
    if (!url) thumb = el('div', 'missing', 'file missing');
    else if (a.kind === 'image') { const img = el('img'); img.src = url; img.loading = 'lazy'; thumb = img; }
    else if (a.kind === 'audio') { const cv = el('canvas'); cv.width = 240; cv.height = 90; void waveform(url, cv); thumb = cv; }
    else {
      const img = el('img');
      const key = `asset:${id}:${url}:${a.scale}:${a.yaw}:${a.lift}`;
      const hit = thumbCache.get(key);
      if (hit) img.src = hit;
      else loadModel(a, media.get(`${a.kind}/${a.file}`)?.hash.slice(0, 10)).then((m) => (img.src = thumbOf(key, m)), () => img.replaceWith(el('div', 'missing', "won't load")));
      thumb = img;
    }
    return card(a.name, sub, a.kind, thumb, () => host.openRecord('assets', id), !url);
  }
  function builtinCard(b: Builtin) {
    const img = el('img');
    img.src = thumbOf(`builtin:${b.id}`, b.build());
    const use = host.builtinUse(b);
    const sub = use.replacedBy ? `replaced by ${use.replacedBy}` : use.user ? `in use · ${use.user.name}` : b.group;
    return card(b.name, sub, 'built-in', img, () => host.openBuiltin(b.id));
  }
  fill();
  main.replaceChildren(head, chips, el('div', 'drop-hint', `Drop files anywhere to add them: models .glb · images ${ASSET_EXT.image.map((e) => '.' + e).join(' ')} · audio ${ASSET_EXT.audio.map((e) => '.' + e).join(' ')} (up to 64 MB each).`), grid);

  aside.replaceChildren(
    el('div', 'group', 'About assets'),
    el('div', 'help-block',
      'Files live in public/media/<kind>/ and each has a record in content/assets/ (name, source, credit and, for models, import scale / rotation / lift). ' +
      'Assign a model to a unit or building with its Model field; the game swaps the built-in for it. Commit includes media files.'),
    el('div', 'group', 'Models'),
    el('div', 'help-block',
      'glTF binary (.glb), front facing +Z, Y up. 1 world unit ≈ 10 m, so set Import scale or use Fit. Units are drawn up to ~1,500 at once on a phone: keep them under ~1,500 triangles. ' +
      'Built-ins can be downloaded as .glb as a starting point in Blender.'),
  );
}

// ---------- built-in detail ----------
export function renderBuiltin(main: HTMLElement, aside: HTMLElement, host: AssetHost, id: string): { dispose(): void } | null {
  const b = builtinById(id);
  if (!b) return null;
  const viewer = new Viewer();
  const obj = b.build();
  viewer.set(obj);
  const st = modelStats(obj);
  const use = host.builtinUse(b);
  const dl = button('Download .glb', () => void exportGlb(b.build(), b.id));
  main.replaceChildren(
    el('div', 'head', el('div', '', el('h1', '', b.name), el('div', 'path', `built-in · ${b.where}`)), el('div', 'actions', dl)),
    el('div', 'viewer-host', viewer.wrap),
    el('div', 'stats', statsLine(st)),
  );
  const rows: (Node | string)[] = [
    el('div', 'group', 'In the game'),
    el('div', 'help-block', b.note ?? (b.swappable ? 'Can be replaced by an asset model.' : '')),
  ];
  if (use.user) {
    const link = button(`${use.user.name} (${use.user.coll})`, () => host.openRecord(use.user!.coll, use.user!.id), 'linkish');
    rows.push(el('div', 'help-block', use.replacedBy ? `${use.user.name} now uses the asset "${use.replacedBy}" instead.` : 'Used by: ', link));
    if (b.swappable && !use.replacedBy) rows.push(el('div', 'help-block', `To replace it: upload a .glb, then set ${use.user.name}'s Model field.`));
  }
  aside.replaceChildren(...rows);
  return { dispose: () => viewer.dispose() };
}

function statsLine(st: ReturnType<typeof modelStats>) {
  const s = st.size;
  return `${st.tris.toLocaleString()} triangles · ${st.verts.toLocaleString()} vertices · ${st.meshes} mesh${st.meshes === 1 ? '' : 'es'} · ${st.materials} material${st.materials === 1 ? '' : 's'} · ` +
    `${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} u (${(s.x * 10).toFixed(0)} × ${(s.y * 10).toFixed(0)} × ${(s.z * 10).toFixed(0)} m)`;
}

// ---------- asset record panel (above the form) ----------
export class AssetPanel {
  readonly root = el('div', 'asset-panel');
  private viewer: Viewer | null = null;
  private inner: THREE.Object3D | null = null;
  private model: THREE.Group | null = null;
  private stats = el('div', 'stats');
  private refId = '';
  private disposed = false;

  constructor(private id: string, private draft: AssetDef, private host: AssetHost, private save: () => Promise<boolean>) {
    this.build();
  }

  private build() {
    const a = this.draft, media = this.host.media();
    const url = urlOf(a, media);
    const info = media.get(`${a.kind}/${a.file}`);
    const used = this.host.usedBy(this.id);
    const fileRow = el('div', 'file-row',
      el('span', '', `public/media/${a.kind}/${a.file}`), el('span', 'dim', info ? fmtBytes(info.bytes) : 'missing!'),
      button('Replace file…', () => void this.replace()),
    );
    if (url) { const d = el('a', 'linkish', 'Download'); d.href = url; d.download = a.file; fileRow.append(d); }
    const usedRow = el('div', 'used-row', used.length ? 'Used by ' : 'Not used by anything yet.');
    used.forEach((u, i) => usedRow.append(i ? ', ' : '', button(`${u.name} (${u.coll})`, () => this.host.openRecord(u.coll, u.id), 'linkish')));
    this.root.replaceChildren();

    if (!url) {
      this.root.append(el('div', 'missing big', `The file public/media/${a.kind}/${a.file} is missing. Use Replace file to upload it again.`), fileRow, usedRow);
      return;
    }
    if (a.kind === 'model') {
      this.viewer = new Viewer();
      const tools = el('div', 'viewer-tools');
      const sel = el('select');
      sel.append(el('option', '', 'Compare with: nothing'));
      (sel.lastChild as HTMLOptionElement).value = '';
      for (const b of BUILTINS) { const o = el('option', '', `Compare with: ${b.name}`); o.value = b.id; sel.append(o); }
      // default comparison: the built-in this model replaces
      const firstUse = used[0];
      this.refId = firstUse ? (BUILTINS.find((b) => b.usedBy?.coll === firstUse.coll && b.usedBy.id === firstUse.id)?.id ?? '') : '';
      sel.value = this.refId;
      sel.onchange = () => { this.refId = sel.value; this.showRef(); };
      tools.append(sel,
        button('Fit to comparison', () => this.fit(), ''),
        button('Sit on ground', () => this.sit(), ''),
        button('Turn 90°', () => this.turn(), ''),
      );
      const perf = used.some((u) => u.coll === 'units') ? el('div', 'perf') : null;
      this.root.append(el('div', 'viewer-host', this.viewer.wrap), tools, this.stats, ...(perf ? [perf] : []), fileRow, usedRow);
      loadModel({ ...a, scale: 1, yaw: 0, lift: 0 }, info?.hash.slice(0, 10)).then((g) => {
        if (this.disposed) return;
        this.inner = g.children[0];
        this.model = applyImport(this.inner, a);
        this.viewer!.set(this.model);
        this.showRef();
        this.refreshStats();
        if (perf) {
          const t = modelStats(this.model).tris;
          perf.textContent = t > 1500 ? `⚠ ${t.toLocaleString()} triangles: units can be on screen by the hundred; aim for under ~1,500.` : `✓ ${t.toLocaleString()} triangles: fine for a unit.`;
          perf.classList.toggle('bad', t > 1500);
        }
      }, (e) => { this.stats.textContent = `Couldn't load this model: ${(e as Error).message ?? e}`; this.stats.classList.add('bad'); });
    } else if (a.kind === 'image') {
      const img = el('img');
      img.src = url;
      const box = el('div', 'image-box', img);
      const tile = el('label', 'check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.onchange = () => { box.classList.toggle('tiled', cb.checked); box.style.backgroundImage = cb.checked ? `url("${url}")` : ''; };
      tile.append(cb, ' Show tiled (as a texture)');
      img.onload = () => (this.stats.textContent = `${img.naturalWidth} × ${img.naturalHeight} px${isPow2(img.naturalWidth) && isPow2(img.naturalHeight) ? '' : ' · not a power of two (fine for UI art; textures tile best at 256/512/1024)'}`);
      this.root.append(box, tile, this.stats, fileRow, usedRow);
    } else {
      const cv = el('canvas', 'wave');
      cv.width = 900; cv.height = 120;
      const audio = el('audio');
      audio.controls = true;
      audio.src = url;
      this.root.append(cv, audio, this.stats, fileRow, usedRow);
      void waveform(url, cv).then((buf) => {
        this.stats.textContent = buf ? `${buf.duration.toFixed(2)} s · ${buf.numberOfChannels === 1 ? 'mono' : buf.numberOfChannels === 2 ? 'stereo' : `${buf.numberOfChannels} channels`}` : "Couldn't decode this audio.";
      });
    }
  }

  /** The form changed: re-apply the import transform live. */
  update(d: AssetDef) {
    this.draft = d;
    if (!this.inner || !this.model) return;
    this.inner.scale.setScalar(d.scale ?? 1);
    this.inner.rotation.y = THREE.MathUtils.degToRad(d.yaw ?? 0);
    this.inner.position.y = d.lift ?? 0;
    this.showRef(false);
    this.refreshStats();
  }

  private showRef(reframe = true) {
    if (!this.viewer) return;
    const b = this.refId ? builtinById(this.refId) : undefined;
    this.viewer.setReference(b ? b.build() : null, reframe);
  }

  private refreshStats() {
    if (!this.model) return;
    this.stats.textContent = statsLine(modelStats(this.model));
  }

  private setFields(patch: Partial<AssetDef>) {
    // write through the form inputs so the editor's dirty tracking and "was" markers update
    for (const [k, v] of Object.entries(patch)) {
      const inp = document.querySelector<HTMLInputElement>(`.row[data-key=${k}] input`);
      if (!inp) continue;
      inp.value = String(v);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  private fit() {
    const b = this.refId ? builtinById(this.refId) : undefined;
    if (!b || !this.inner) { this.host.toast('Pick a built-in to compare with first', true); return; }
    const ref = new THREE.Box3().setFromObject(b.build()).getSize(new THREE.Vector3());
    const probe = this.inner.clone();
    probe.scale.setScalar(1);
    probe.position.set(0, 0, 0);
    const raw = new THREE.Box3().setFromObject(probe).getSize(new THREE.Vector3());
    const ext = Math.max(raw.x, raw.z), want = Math.max(ref.x, ref.z);
    if (!(ext > 0)) return;
    const scale = Number((want / ext).toPrecision(3));
    this.setFields({ scale });
    this.sit();
  }

  private sit() {
    if (!this.inner) return;
    const probe = this.inner.clone();
    probe.position.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(probe);
    this.setFields({ lift: Number((-box.min.y).toFixed(2)) });
  }

  private turn() {
    let yaw = (this.draft.yaw ?? 0) + 90;
    if (yaw > 180) yaw -= 360;
    this.setFields({ yaw });
  }

  private async replace() {
    const a = this.draft;
    const [f] = await pickFiles(ASSET_EXT[a.kind].map((e) => '.' + e).join(','), false);
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ASSET_EXT[a.kind].includes(ext)) { this.host.toast(`A ${a.kind} needs ${ASSET_EXT[a.kind].join(' / ')}`, true); return; }
    const media = this.host.media();
    const oldPath = `${a.kind}/${a.file}`;
    const newFile = `${this.id}.${ext}`;
    const newPath = `${a.kind}/${newFile}`;
    try {
      await this.host.api('PUT', `/__content/media?path=${encodeURIComponent(newPath)}&baseHash=${media.get(newPath)?.hash ?? ''}`, f);
      if (newPath !== oldPath && media.has(oldPath)) await this.host.api('DELETE', '/__content/media', { path: oldPath, baseHash: media.get(oldPath)!.hash });
      forgetModel();
      if (a.file !== newFile) {
        const inp = document.querySelector<HTMLInputElement>('.row[data-key=file] input');
        if (inp) { inp.value = newFile; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        await this.save();
      }
      await this.host.refresh();
      this.host.toast(`Replaced with ${f.name}`);
      this.host.openRecord('assets', this.id);
    } catch (e) {
      this.host.toast(`Replace failed: ${(e as Error).message}`, true);
    }
  }

  dispose() {
    this.disposed = true;
    this.viewer?.dispose();
  }
}

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
