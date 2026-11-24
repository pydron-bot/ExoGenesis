/**
 * Sun shadows up close: a real shadow map round what the camera looks at.
 *
 * The sun is a point light at the sun's place (src/world/system.ts); a point light's shadows would be six renders
 * a frame. So near the ground a directional light, along the same sun direction and in the same colour, takes the
 * sunlight over: `handoff` (0..1) moves the point light's intensity to it, the sum unchanged, so nothing changes in
 * brightness. It casts a shadow map over a box round the camera's focus, sized to the zoom; the shadow camera
 * steps in whole shadow-map texels so the edges don't crawl as the camera pans. Zoomed out (and in orbit) it hands
 * the sun back and the light map's blob shadows (src/world/lights.ts) take over again.
 *
 * What casts and receives: lit, opaque meshes (units, buildings, plants, the ground), marked by `mark()` every so
 * often; glow parts, glass, water, the sky, bars and rings don't.
 */
import * as THREE from 'three';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class SunShadows {
  readonly light = new THREE.DirectionalLight('#ffffff', 0);
  private on = false;
  private size: number;
  /** 0..1: how much of the sun this light carries now (test hook). */
  handoff = 0;
  private lastMark = -1e9;
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, phone: boolean) {
    this.size = phone ? 1024 : 2048;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const l = this.light;
    l.castShadow = true;
    l.shadow.mapSize.set(this.size, this.size);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.04;
    l.shadow.camera.near = 1;
    l.shadow.camera.far = 900;
    l.visible = false;
    scene.add(l, l.target);
  }

  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    this.renderer.shadowMap.enabled = v;
    if (!v) { this.light.visible = false; this.handoff = 0; }
    // materials compile with or without shadow code: recompile the lit ones
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
    });
  }

  /**
   * Call each frame before rendering. `focus` (world) is what the camera looks at, `sunDir` a unit vector toward
   * the sun, `camDist` the zoom, `air` 1 near the ground .. 0 in orbit; `color` and `intensity` the sunlight's.
   * Returns the handoff: the share of the sun the point light should give up.
   */
  update(focus: THREE.Vector3, sunDir: THREE.Vector3, camDist: number, air: number, color: THREE.Color, intensity: number, now: number) {
    const k = this.on ? (1 - smooth(110, 170, camDist)) * smooth(0.6, 0.95, air) : 0;
    this.handoff = k;
    const l = this.light;
    l.visible = k > 0.001;
    if (!l.visible) return 0;
    l.color.copy(color);
    l.intensity = intensity * k;
    // the box round the focus: a little wider than the view at this zoom
    const ext = THREE.MathUtils.clamp(camDist * 1.25, 18, 190);
    const cam = l.shadow.camera;
    if (cam.right !== ext) { cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.updateProjectionMatrix(); }
    // step the focus in whole texels (in the light's own frame), so shadow edges hold still while panning
    const texel = (2 * ext) / this.size;
    l.position.copy(sunDir).multiplyScalar(400);
    l.target.position.set(0, 0, 0);
    l.lookAt(0, 0, 0);
    this.q.copy(l.quaternion).invert();
    const f = this.v.copy(focus).applyQuaternion(this.q);
    f.set(Math.round(f.x / texel) * texel, Math.round(f.y / texel) * texel, f.z).applyQuaternion(l.quaternion);
    l.target.position.copy(f);
    l.position.copy(f).addScaledVector(sunDir, 400);
    l.target.updateMatrixWorld();
    l.updateMatrixWorld();
    if (now - this.lastMark > 1) { this.lastMark = now; this.mark(); }
    return k;
  }

  /** Lit, opaque meshes cast and receive (new ones appear as buildings go up and units arrive). */
  private mark() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.noShadow) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const lit = mats.some((m) => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && !m.transparent);
      // glow-only meshes (black + emissive) neither cast nor catch
      const glowOnly = mats.every((m) => { const s = m as THREE.MeshStandardMaterial; return !s.isMeshStandardMaterial || (s.color?.getHex() === 0 && s.emissiveIntensity > 0); });
      const v = lit && !glowOnly;
      if (mesh.castShadow !== v) mesh.castShadow = v;
      if (mesh.receiveShadow !== v) mesh.receiveShadow = v;
    });
  }
}
