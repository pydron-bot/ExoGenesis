/**
 * A comet's look in the system view: a glowing coma round the nucleus, a straight
 * blue ion tail pointing straight away from the star (with streaks that drift
 * outward), and a wider, warmer dust tail that curves back along the orbit. Both
 * grow as the comet nears the star and shrink to a faint wisp far out.
 *
 * Each tail is a ribbon that turns about its own spine to face the camera, so it
 * reads from any side; the spine is rebuilt on the CPU every frame (a few dozen
 * points), the soft edges, fades and streaks are drawn per pixel.
 */
import * as THREE from 'three';
import { smoothstep } from './noise';

const SEG = 40;

const vert = /* glsl */`
attribute float aT;
attribute float aS;
varying float vT;
varying float vS;
void main() {
  vT = aT; vS = aS;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uStreaks;
varying float vT;
varying float vS;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float s = abs(vS);
  // soft across the tail, softer still further out
  float across = pow(max(0.0, 1.0 - s), mix(2.2, 1.2, vT));
  // fades in just behind the head, out towards the end
  float along = smoothstep(0.0, 0.03, vT) * pow(1.0 - vT, 1.4);
  // brightest close to the head
  float head = 1.0 + 2.5 * exp(-vT * 10.0);
  // fine filaments streaming outward (ion tail), gentle mottling (dust)
  float fil = noise(vec2(vS * 9.0, vT * 2.0 - uTime * 0.25)) * 0.6 + noise(vec2(vS * 23.0, vT * 5.0 - uTime * 0.6)) * 0.4;
  float tex = mix(0.8 + 0.4 * noise(vec2(vS * 3.0, vT * 3.0 - uTime * 0.05)), 0.35 + 1.1 * fil, uStreaks);
  float a = across * along * head * tex * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

function ribbon(color: string, streaks: number): THREE.Mesh {
  const n = (SEG + 1) * 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const at = new Float32Array(n), as = new Float32Array(n);
  for (let i = 0; i <= SEG; i++) { at[i * 2] = at[i * 2 + 1] = i / SEG; as[i * 2] = -1; as[i * 2 + 1] = 1; }
  geo.setAttribute('aT', new THREE.BufferAttribute(at, 1));
  geo.setAttribute('aS', new THREE.BufferAttribute(as, 1));
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uStreaks: { value: streaks } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
  }));
  m.frustumCulled = false;
  return m;
}

let comaTex: THREE.Texture | null = null;
function comaTexture() {
  if (comaTex) return comaTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.08, 'rgba(235,250,255,0.9)');
  gr.addColorStop(0.25, 'rgba(170,225,255,0.35)');
  gr.addColorStop(0.6, 'rgba(120,190,255,0.08)');
  gr.addColorStop(1, 'rgba(100,170,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  comaTex = new THREE.CanvasTexture(cv);
  comaTex.colorSpace = THREE.SRGBColorSpace;
  return comaTex;
}

const v = new THREE.Vector3(), p = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();

export class CometLook {
  readonly group = new THREE.Group();
  private ion = ribbon('#6cc8ff', 1);
  private dust = ribbon('#ffe6c2', 0);
  private coma: THREE.Sprite;
  /** 0 (far out, dormant) .. 1 (at perihelion), last update (test hook). */
  activity = 0;

  constructor(private radius: number) {
    this.coma = new THREE.Sprite(new THREE.SpriteMaterial({
      map: comaTexture(), color: '#e4f6ff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    }));
    this.group.add(this.dust, this.ion, this.coma);
  }

  /**
   * `pos` the nucleus, `star` the star's place, `vel` the direction it's moving (unit),
   * `vis` 0..1 overall strength, `t` seconds (for the drifting streaks).
   */
  /** At least this active (0..1): the title tour, alongside this comet, shows it in full flow. */
  boost = 0;

  update(pos: THREE.Vector3, star: THREE.Vector3, vel: THREE.Vector3, camera: THREE.Camera, vis: number, t: number) {
    const dSun = pos.distanceTo(star);
    const act = this.activity = Math.max(smoothstep(230000, 35000, dSun), this.boost);
    this.group.visible = vis > 0.01;
    if (!this.group.visible) return;
    const away = v.subVectors(pos, star).normalize();
    const L = 75000 * act + 2500;
    // ion: straight out from the star, narrow
    this.build(this.ion, pos, away, vel, L * 1.15, 0, L * 0.006, L * 0.05, camera);
    // dust: shorter, broader, swept back behind the comet's motion
    this.build(this.dust, pos, away, vel, L * 0.8, 0.5, L * 0.012, L * 0.17, camera);
    const ion = this.ion.material as THREE.ShaderMaterial, dust = this.dust.material as THREE.ShaderMaterial;
    ion.uniforms.uOpacity.value = vis * (0.25 + 0.75 * act) * 0.9;
    dust.uniforms.uOpacity.value = vis * (0.2 + 0.8 * act) * 0.9;
    ion.uniforms.uTime.value = dust.uniforms.uTime.value = t;
    // the coma: a soft glow round the head, never smaller than a few pixels so it can be found
    const camD = camera.position.distanceTo(pos);
    this.coma.position.copy(pos);
    this.coma.scale.setScalar(Math.max(this.radius * (8 + 50 * act), camD * 0.012));
    (this.coma.material as THREE.SpriteMaterial).opacity = vis * (0.55 + 0.45 * act);
  }

  private build(m: THREE.Mesh, head: THREE.Vector3, away: THREE.Vector3, vel: THREE.Vector3, len: number, bend: number, w0: number, w1: number, camera: THREE.Camera) {
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      // spine and its direction (a parabola: lags behind the motion more the further out)
      p.copy(head).addScaledVector(away, len * s).addScaledVector(vel, -len * bend * s * s);
      tan.copy(away).addScaledVector(vel, -2 * bend * s).normalize();
      side.subVectors(camera.position, p).cross(tan).normalize();
      const w = w0 + (w1 - w0) * Math.sqrt(s);
      pos.setXYZ(i * 2, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      pos.setXYZ(i * 2 + 1, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
    }
    pos.needsUpdate = true;
  }
}
