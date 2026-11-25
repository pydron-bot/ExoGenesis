/**
 * Decals draped on the terrain round the landing pad: a disc of world-space vertices sampled from the ground
 * (so it follows the bumps), drawn with its own small shader. (MeshBasicMaterial with 4-component vertex
 * colours drew nothing here, so the RGBA is a custom attribute.) Used by the landing's firelight and the
 * scorch the landing leaves under the Command Core.
 */
import * as THREE from 'three';
import { regionToWorld } from './planet';

/**
 * A disc draped on the terrain around the pad (world-space vertices sampled from the
 * ground, so it follows the bumps); `paint(r01, angle)` gives each vertex's RGBA.
 */
export function groundDisc(radius: number, lift: number, paint: (r: number, a: number) => [number, number, number, number]) {
  const rings = 18, segs = 56;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  regionToWorld(0, 0, lift, v);
  pos.push(v.x, v.y, v.z);
  col.push(...paint(0, 0));
  for (let r = 1; r <= rings; r++) {
    const rr = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      regionToWorld(Math.cos(a) * rr * radius, Math.sin(a) * rr * radius, lift, v);
      pos.push(v.x, v.y, v.z);
      col.push(...paint(rr, a));
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs, b0 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, b0 + s, b0 + s1, a0 + s, b0 + s1, a0 + s1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRGBA', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** For a groundDisc: its per-vertex RGBA times `uOpacity`. */
export function decalMaterial(additiveBlend: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 aRGBA;
      varying vec4 vC;
      void main() {
        vC = aRGBA;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uOpacity;
      varying vec4 vC;
      void main() {
        #include <logdepthbuf_fragment>
        float a = vC.a * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vC.rgb, a);
      }`,
    transparent: true, depthWrite: false, blending: additiveBlend ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}


/** The scorch the landing burn leaves round the pad: ragged-edged, darkest in the middle. */
export function scorchDecal(radius = 24): THREE.Mesh {
  const jag = Array.from({ length: 7 }, (_, i) => [((i * 2.399) % 6.283), 1 + (i * 3) % 5]);
  const m = new THREE.Mesh(groundDisc(radius, 0.3, (r, a) => {
    const edge = 0.72 + jag.reduce((s, [ph, f]) => s + Math.sin(a * f + ph) * 0.045, 0);
    const k = (1 - THREE.MathUtils.smoothstep(r, edge * 0.3, edge)) * (0.75 + 0.2 * Math.sin(a * 13 + r * 40) * Math.sin(r * 23));
    return [0.03, 0.022, 0.018, k];
  }), decalMaterial(false));
  m.frustumCulled = false;
  m.renderOrder = 1;
  m.name = 'scorch';
  return m;
}
