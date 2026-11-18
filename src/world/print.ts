/**
 * Printed construction: a building under construction is its real model being "printed" from
 * the ground up. Below the print line it's solid, with a glowing cyan band at the line and a
 * glowing cross-section where the cut opens the model; above it, the rest of the model is a
 * faint cyan wireframe with scanlines running up it; a few sparks jump along the line.
 *
 * Each building gets its own material copies (the line height is per building), patched with
 * onBeforeCompile; every copy shares one shader program per material type. The colony light map
 * patch (lights.ts) wraps these later, on first draw. When the building finishes, region.ts swaps
 * in the plain model and calls dispose().
 */
import * as THREE from 'three';

const CYAN = new THREE.Color('#5ff4ff');
const SPARKS = 18;

/** A soft round dot for the sparks (points are squares otherwise). */
let dot: THREE.Texture | null = null;
function sparkDot() {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

interface PrintUniforms {
  uCut: { value: number };
  uBase: { value: THREE.Vector3 };
  uUp: { value: THREE.Vector3 };
  uPrT: { value: number };
  uPrCol: { value: THREE.Color };
}

const VERT_DECL = /* glsl */ `
  uniform vec3 uBase, uUp;
  varying float vPrH;`;
const VERT_BODY = /* glsl */ `
  {
    vec4 prW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      prW = instanceMatrix * prW;
    #endif
    vPrH = dot((modelMatrix * prW).xyz - uBase, uUp);
  }`;
const FRAG_DECL = /* glsl */ `
  uniform float uCut, uPrT;
  uniform vec3 uPrCol;
  varying float vPrH;`;

function patchVertex(sh: { vertexShader: string }) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>${VERT_DECL}`)
    .replace('#include <project_vertex>', `#include <project_vertex>${VERT_BODY}`);
}

/** The solid part: discard above the line; a hot band at the line; inside faces glow (the cut face). */
function solidMaterial(src: THREE.Material, u: PrintUniforms): THREE.Material {
  const m = src.clone();
  delete m.userData.lm; // the light map patch is per material: let lights.ts patch this copy too
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    patchVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_DECL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vPrH > uCut) discard;`);
    if (sh.fragmentShader.includes('#include <emissivemap_fragment>')) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float band = 1.0 - smoothstep(0.0, 0.45, uCut - vPrH);
          float flick = 0.85 + 0.15 * sin(uPrT * 23.0 + vPrH * 9.0);
          totalEmissiveRadiance += uPrCol * band * 2.6 * flick;
          if (!gl_FrontFacing) {
            // looking into the model through the cut: a glowing cross-section
            diffuseColor.rgb *= 0.08;
            totalEmissiveRadiance = uPrCol * (0.55 + 0.25 * flick);
          }
        }`);
    } else {
      // unlit parts (glow strips): just brighten them at the line
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        outgoingLight += uPrCol * (1.0 - smoothstep(0.0, 0.45, uCut - vPrH)) * 2.0;
        #include <opaque_fragment>`);
    }
  };
  m.customProgramCacheKey = () => 'print-solid';
  m.needsUpdate = true;
  return m;
}

/** The unbuilt part: a faint wireframe above the line, brightest just above it, with scanlines. */
function wireMaterial(u: PrintUniforms): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: CYAN, wireframe: true, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  m.userData.lm = false; // unlit: nothing for the light map to do
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    patchVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_DECL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vPrH < uCut) discard;`)
      .replace('#include <opaque_fragment>', `
        float near = 1.0 - smoothstep(0.0, 1.6, vPrH - uCut);
        float scan = 0.55 + 0.45 * sin(vPrH * 4.0 - uPrT * 5.0);
        outgoingLight *= 0.7 + 2.2 * near;
        diffuseColor.a *= scan * (0.6 + 0.4 * near);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'print-wire';
  return m;
}

export class Printed {
  readonly root = new THREE.Group();
  private u: PrintUniforms = {
    uCut: { value: 0 }, uBase: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3(0, 1, 0) },
    uPrT: { value: 0 }, uPrCol: { value: CYAN.clone() },
  };
  private box = new THREE.Box3();
  private mats: THREE.Material[] = [];
  private sparks: THREE.Points;
  private sparkPos: Float32Array;
  private sparkLife = new Float32Array(SPARKS);
  private q = new THREE.Quaternion();

  /** `model`: a fresh copy of the finished building's model (its materials are copied, not changed). */
  constructor(model: THREE.Object3D) {
    this.root.name = 'printed';
    this.root.add(model);
    this.root.updateMatrixWorld(true);
    this.box.setFromObject(model);
    if (this.box.isEmpty()) this.box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 4, 2));
    const wire = wireMaterial(this.u);
    this.mats.push(wire);
    const solids = new Map<THREE.Material, THREE.Material>();
    const solidOf = (m: THREE.Material) => {
      let s = solids.get(m);
      if (!s) { s = solidMaterial(m, this.u); solids.set(m, s); this.mats.push(s); }
      return s;
    };
    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const mesh of meshes) {
      // see-through parts (gate fields, steam plumes) wait for the finished model
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => m.transparent)) { mesh.visible = false; continue; }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(solidOf) : solidOf(mesh.material);
      // the wireframe twin: same geometry and pose, drawn over the unbuilt part
      const w = new THREE.Mesh(mesh.geometry, wire);
      w.name = 'print-wire';
      w.position.copy(mesh.position); w.quaternion.copy(mesh.quaternion); w.scale.copy(mesh.scale);
      w.renderOrder = 2;
      mesh.parent!.add(w);
    }
    // sparks along the line
    this.sparkPos = new Float32Array(SPARKS * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    const sm = new THREE.PointsMaterial({
      color: '#d8fdff', size: 0.6, map: sparkDot(), transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mats.push(sm);
    this.sparks = new THREE.Points(g, sm);
    this.sparks.frustumCulled = false;
    this.root.add(this.sparks);
  }

  /** Model height (root-local, above its base). */
  get height() { return this.box.max.y - Math.max(0, this.box.min.y); }

  /** Per frame: build progress 0..1 and time (s). */
  set(progress: number, t: number) {
    const p = 0.04 + 0.96 * Math.min(1, Math.max(0, progress));
    const lo = Math.max(0, this.box.min.y);
    const cut = lo + (this.box.max.y - lo) * p;
    const u = this.u;
    u.uCut.value = cut;
    u.uPrT.value = t;
    // world base and up of the building: the line is measured along the building's own up
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldPosition(u.uBase.value);
    u.uUp.value.set(0, 1, 0).applyQuaternion(this.root.getWorldQuaternion(this.q)).normalize();
    // sparks: a few at a time jump to a new spot on the footprint's edge at the line, then fade
    const b = this.box;
    for (let i = 0; i < SPARKS; i++) {
      this.sparkLife[i] -= 0.05 + Math.random() * 0.08;
      if (this.sparkLife[i] <= 0) {
        this.sparkLife[i] = 1;
        const side = Math.floor(Math.random() * 4), f = Math.random();
        const x = side < 2 ? THREE.MathUtils.lerp(b.min.x, b.max.x, f) : side === 2 ? b.min.x : b.max.x;
        const z = side >= 2 ? THREE.MathUtils.lerp(b.min.z, b.max.z, f) : side === 0 ? b.min.z : b.max.z;
        this.sparkPos[i * 3] = x * 0.85; this.sparkPos[i * 3 + 2] = z * 0.85;
      }
      this.sparkPos[i * 3 + 1] = cut + (1 - this.sparkLife[i]) * 0.6;
    }
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.material as THREE.PointsMaterial).opacity = 0.6 + 0.4 * Math.sin(t * 31);
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.sparks.geometry.dispose();
  }
}
