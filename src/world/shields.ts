/**
 * Shield domes and bubbles (Shield Projector, Aegis Crawler): a see-through
 * sphere centred on the ground, glowing at its rim, with a faint lattice. It
 * brightens for a moment when it takes a hit (its charge dropped since the last
 * frame), fades with its charge, and is gone while the shield is down.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uCharge;
uniform float uHit;
uniform float uTime;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  float rim = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  rim = pow(rim, 2.4);
  // a lattice of latitude and longitude lines, drifting slowly
  float lat = abs(fract(vLocal.y * 6.0 - uTime * 0.15) - 0.5);
  float lon = abs(fract(atan(vLocal.z, vLocal.x) * 3.8197 + uTime * 0.05) - 0.5);
  float grid = smoothstep(0.06, 0.0, min(lat, lon) - 0.01) * 0.35;
  float a = (0.05 + rim * 0.55 + grid * (0.25 + rim)) * (0.35 + 0.65 * uCharge) + uHit * (0.25 + rim * 0.6);
  gl_FragColor = vec4(uColor * (1.0 + uHit * 1.5), a);
}`;

interface Entry { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; last: number; hit: number }

export interface ShieldLook { id: string; x: number; z: number; r: number; charge: number; up: boolean }

export class ShieldDomes {
  readonly group = new THREE.Group();
  private list = new Map<string, Entry>();
  private geo = new THREE.SphereGeometry(1, 40, 20);
  /** `place` stands an object on the ground at region (x, z), upright (region.ts `orient`). */
  constructor(private place: (o: THREE.Object3D, x: number, z: number) => void, private color = new THREE.Color('#7fe8ff')) {
    this.group.name = 'shields';
  }

  /** Draw these shields this frame (any not listed are removed). `dt` in seconds. */
  sync(shields: ShieldLook[], t: number, dt: number) {
    const seen = new Set<string>();
    for (const s of shields) {
      seen.add(s.id);
      let e = this.list.get(s.id);
      if (!e) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: { uColor: { value: this.color }, uCharge: { value: 1 }, uHit: { value: 0 }, uTime: { value: 0 } },
        });
        const mesh = new THREE.Mesh(this.geo, mat);
        mesh.renderOrder = 5;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        e = { mesh, mat, last: s.charge, hit: 0 };
        this.list.set(s.id, e);
      }
      // a drop in charge is a hit: flash
      if (s.charge < e.last - 1e-4) e.hit = 1;
      e.last = s.charge;
      e.hit = Math.max(0, e.hit - dt * 3);
      e.mesh.visible = s.up;
      if (!s.up) continue;
      this.place(e.mesh, s.x, s.z);
      e.mesh.scale.setScalar(s.r);
      e.mat.uniforms.uCharge.value = s.charge;
      e.mat.uniforms.uHit.value = e.hit;
      e.mat.uniforms.uTime.value = t;
    }
    for (const [id, e] of this.list) {
      if (seen.has(id)) continue;
      this.group.remove(e.mesh);
      e.mat.dispose();
      this.list.delete(id);
    }
  }
}
