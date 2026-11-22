/**
 * Weather, for the look only (the sim never sees it, so saves, replays and balance are unchanged):
 * passing showers and dust storms that darken the sky, pull the haze in and dim the sun.
 *
 * What comes is a pure function of the game clock: time is cut into spells of `SPELL` seconds, each
 * picked from a hash of its index (mostly clear; on bodies with seas, rain; on bodies with air, dust
 * storms), and each spell eases in and out over its first and last `EASE` seconds. Bodies without air
 * have none. `?weather=rain|dust|clear` holds one for testing.
 *
 * The drops (or blown sand) are 2400 short lines in a box that follows the camera's focus, animated
 * entirely in the vertex shader (each wraps round the box as it falls), so it costs one draw call and
 * no per-frame upload. Shown near the ground only.
 */
import * as THREE from 'three';
import { smoothstep } from './noise';

export type WeatherKind = 'clear' | 'rain' | 'dust';

const SPELL = 240;
const EASE = 45;
const COUNT = 2400;

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class Weather {
  readonly lines: THREE.LineSegments;
  enabled = true;
  /** What's happening now and how strongly (0..1), after update(). */
  kind: WeatherKind = 'clear';
  amount = 0;
  private hold: WeatherKind | null;

  constructor(private wet: boolean, private air: boolean, hold: string | null) {
    this.hold = hold === 'rain' || hold === 'dust' || hold === 'clear' ? hold : null;
    const pos = new Float32Array(COUNT * 2 * 3);
    const end = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const x = Math.random() * 2 - 1, y = Math.random(), z = Math.random() * 2 - 1;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() }, uE: { value: new THREE.Vector3(1, 0, 0) }, uN: { value: new THREE.Vector3(0, 0, 1) }, uU: { value: new THREE.Vector3(0, 1, 0) },
        uSize: { value: 60 }, uHeight: { value: 40 }, uTime: { value: 0 }, uFall: { value: 30 }, uWind: { value: new THREE.Vector2() },
        uStreak: { value: 1.2 }, uColor: { value: new THREE.Color('#a9bccf') }, uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */`
        attribute float aEnd;
        uniform vec3 uCenter, uE, uN, uU;
        uniform float uSize, uHeight, uTime, uFall, uStreak;
        uniform vec2 uWind;
        varying float vA;
        void main() {
          // falling (and blown) through the box, wrapping round it
          float y = fract(position.y - uTime * uFall / uHeight);
          vec2 xz = fract((position.xz * 0.5 + 0.5) + uWind * uTime / uSize) * 2.0 - 1.0;
          vec3 dir = normalize(uU * -uFall + uE * uWind.x + uN * uWind.y);
          vec3 p = uCenter + uE * xz.x * uSize + uN * xz.y * uSize + uU * y * uHeight - dir * aEnd * uStreak;
          // fade at the box's edges and top so it has no visible bounds
          vA = (1.0 - smoothstep(0.7, 1.0, max(abs(xz.x), abs(xz.y)))) * smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.75, 1.0, y));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vA;
        void main() {
          float a = vA * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(g, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
  }

  /** The weather at game time `secs` (seconds): which, and how strong. */
  at(secs: number): { kind: WeatherKind; amount: number } {
    if (!this.air) return { kind: 'clear', amount: 0 };
    if (this.hold) return { kind: this.hold, amount: this.hold === 'clear' ? 0 : 1 };
    const i = Math.floor(secs / SPELL), r = hash(i), into = secs - i * SPELL;
    let kind: WeatherKind = 'clear';
    // the first spell is always clear (the landing)
    if (i > 0) {
      if (this.wet && r < 0.18) kind = 'rain';
      else if (r > (this.wet ? 0.88 : 0.72)) kind = 'dust';
    }
    const amount = kind === 'clear' ? 0 : smoothstep(0, EASE, into) * (1 - smoothstep(SPELL - EASE, SPELL, into)) * (0.65 + 0.35 * hash(i + 0.5));
    return { kind, amount };
  }

  /**
   * `secs` game time, `t` real seconds (the drops' motion), `focus` the camera's ground focus,
   * `up`/`east`/`north` the local frame, `near` 0..1 how close to the ground the camera is.
   */
  update(secs: number, t: number, focus: THREE.Vector3, up: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3, near: number, camDist: number) {
    const w = this.enabled ? this.at(secs) : { kind: 'clear' as WeatherKind, amount: 0 };
    this.kind = w.kind;
    this.amount = w.amount;
    const u = (this.lines.material as THREE.ShaderMaterial).uniforms;
    const show = w.amount * near;
    this.lines.visible = show > 0.01;
    if (!this.lines.visible) return;
    const size = THREE.MathUtils.clamp(camDist * 0.9, 25, 140);
    u.uCenter.value.copy(focus).addScaledVector(up, -size * 0.15);
    u.uE.value.copy(east); u.uN.value.copy(north); u.uU.value.copy(up);
    u.uSize.value = size;
    u.uHeight.value = size * 0.9;
    u.uTime.value = t;
    if (w.kind === 'rain') {
      u.uFall.value = size * 0.9;
      u.uWind.value.set(size * 0.08, size * 0.03);
      u.uStreak.value = size * 0.035;
      u.uColor.value.set('#b4c6d8');
      u.uOpacity.value = 0.42 * show;
    } else {
      // sand: low, fast and sideways
      u.uFall.value = size * 0.12;
      u.uWind.value.set(size * 0.75, size * 0.2);
      u.uStreak.value = size * 0.05;
      u.uColor.value.set('#d4a978');
      u.uOpacity.value = 0.3 * show;
    }
  }

  /** How the sky, haze and light change: 0..1 darkening, haze pull-in, and the sky's tint. */
  get look() {
    const a = this.amount;
    if (this.kind === 'rain') return { dark: 0.45 * a, haze: 0.45 * a, tint: RAIN_SKY, tintK: 0.7 * a };
    if (this.kind === 'dust') return { dark: 0.35 * a, haze: 0.75 * a, tint: DUST_SKY, tintK: 0.85 * a };
    return { dark: 0, haze: 0, tint: RAIN_SKY, tintK: 0 };
  }
}

const RAIN_SKY = new THREE.Color('#5d6a76');
const DUST_SKY = new THREE.Color('#b07a4c');
