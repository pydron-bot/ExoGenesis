/**
 * Lens flare from the sun: a starburst and a long, thin anamorphic streak on the
 * sun itself, and a row of faint coloured ghosts (discs, hexagons, a ring) along the
 * line from the sun through the middle of the screen, as a camera lens would show.
 *
 * Drawn last, over the finished frame (after the glow pass, if it's on), in a scene
 * of its own with a flat camera, so it costs a handful of sprites. It fades as the sun
 * nears the screen's edge and as anything big (the globe you're on, a planet, a moon)
 * passes in front of it: each is a sphere, and the sun's own disc is allowed to be
 * half covered, so a sunset sinks the flare smoothly instead of switching it off.
 * Options → Lens flare turns it off (remembered; `?flare=0|1` overrides).
 */
import * as THREE from 'three';
import { smoothstep } from './noise';

type Kind = 'glow' | 'ring' | 'hex' | 'streak' | 'rays';

function tex(kind: Kind): THREE.Texture {
  const cv = document.createElement('canvas');
  const W = kind === 'streak' ? 256 : 128, H = kind === 'streak' ? 32 : 128;
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const c = 64;
  if (kind === 'glow') {
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  } else if (kind === 'ring') {
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.78, 'rgba(255,255,255,0)');
    gr.addColorStop(0.88, 'rgba(255,255,255,0.6)');
    gr.addColorStop(0.95, 'rgba(255,255,255,0.15)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  } else if (kind === 'hex') {
    // an aperture-blade ghost: a soft-edged hexagon, a touch brighter at the rim
    g.filter = 'blur(2px)';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      g.lineTo(c + Math.cos(a) * 56, c + Math.sin(a) * 56);
    }
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.stroke();
  } else if (kind === 'streak') {
    const gx = g.createLinearGradient(0, 0, W, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)');
    gx.addColorStop(0.5, 'rgba(255,255,255,1)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gx;
    for (let y = 0; y < H; y++) {
      g.globalAlpha = Math.exp(-(((y - H / 2 + 0.5) / (H * 0.12)) ** 2));
      g.fillRect(0, y, W, 1);
    }
  } else {
    // starburst: thin spikes of different lengths
    g.translate(c, c);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (i % 2) * 0.07;
      const len = (i % 3 === 0 ? 62 : i % 2 ? 34 : 46);
      const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = gr;
      g.lineWidth = i % 3 === 0 ? 2 : 1.2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Element {
  sprite: THREE.Sprite;
  /** Where along the sun → centre → beyond line: 1 on the sun, 0 at the centre, negative across it. */
  at: number;
  /** Size in screen heights. */
  size: number;
  /** Stretch (streak). */
  aspect?: number;
  opacity: number;
  spin?: number;
}

export interface Occluder { pos: THREE.Vector3; radius: number }

const S = new THREE.Vector3(), d = new THREE.Vector3(), oc = new THREE.Vector3();

export class SunFlare {
  enabled = true;
  /** How strong the flare is now, 0..1 (test hook). */
  strength = 0;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  private els: Element[] = [];
  private vis = 0;

  constructor() {
    const textures = new Map<Kind, THREE.Texture>();
    const add = (kind: Kind, at: number, size: number, color: string, opacity: number, extra: Partial<Element> = {}) => {
      if (!textures.has(kind)) textures.set(kind, tex(kind));
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textures.get(kind)!, color, blending: THREE.AdditiveBlending, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false, fog: false,
      }));
      this.scene.add(sprite);
      this.els.push({ sprite, at, size, opacity, ...extra });
    };
    // on the sun
    add('glow', 1, 0.55, '#fff3dc', 0.5);
    add('rays', 1, 0.75, '#fff6e6', 0.55, { spin: 1 });
    add('streak', 1, 1.6, '#9fd0ff', 0.45, { aspect: 0.03 });
    // ghosts
    add('glow', 0.62, 0.07, '#ffd39a', 0.22);
    add('hex', 0.4, 0.09, '#9effc8', 0.12);
    add('ring', 0.18, 0.2, '#ffb070', 0.1);
    add('hex', -0.12, 0.06, '#c8a0ff', 0.14);
    add('glow', -0.3, 0.14, '#6fb7ff', 0.12);
    add('hex', -0.55, 0.18, '#7fe0ff', 0.08);
    add('ring', -0.85, 0.42, '#c0e8ff', 0.07);
    add('glow', -1.15, 0.26, '#ff9fb0', 0.07);
  }

  /**
   * `sun` where the sun is drawn, `sunR` its radius, `occluders` big round things that can
   * hide it, `dim` extra 0..1 (e.g. a bright daytime sky washes the ghosts out).
   */
  update(camera: THREE.PerspectiveCamera, sun: THREE.Vector3, sunR: number, occluders: Occluder[], dim: number, dt: number) {
    const cp = camera.position;
    const toSun = d.subVectors(sun, cp);
    const dist = toSun.length();
    toSun.divideScalar(dist);
    // how much of the sun is uncovered
    let vis = 1;
    for (const o of occluders) {
      oc.subVectors(o.pos, cp);
      const along = oc.dot(toSun);
      if (along <= 0 || along > dist) continue;
      const miss = Math.sqrt(Math.max(0, oc.lengthSq() - along * along));
      const sr = sunR * (along / dist);
      vis *= smoothstep(o.radius - sr, o.radius + sr, miss);
      if (vis <= 0) break;
    }
    S.copy(sun).project(camera);
    const behind = S.z > 1 || toSun.dot(camera.getWorldDirection(oc)) <= 0;
    const edge = behind ? 0 : 1 - smoothstep(0.85, 1.25, Math.max(Math.abs(S.x), Math.abs(S.y)));
    // a small, far sun (the system view) flares less than the big one in the sky
    const size = smoothstep(0.004, 0.05, sunR / dist);
    const target = this.enabled ? vis * edge * (0.45 + 0.55 * size) * (1 - dim) : 0;
    // ease (a planet's edge sweeping over the sun, the camera swinging)
    this.vis += (target - this.vis) * (1 - Math.exp(-dt * 12));
    this.strength = this.vis;
    if (this.vis < 0.003) { this.scene.visible = false; return; }
    this.scene.visible = true;

    const aspect = camera.aspect;
    this.cam.left = -aspect; this.cam.right = aspect; this.cam.top = 1; this.cam.bottom = -1;
    this.cam.updateProjectionMatrix();
    const sx = S.x * aspect, sy = S.y;
    // ghosts brighten as the sun swings toward the middle of the view
    const centre = 1 - smoothstep(0, 1.2, Math.hypot(S.x, S.y));
    const roll = Math.atan2(sy, sx);
    const big = smoothstep(0.08, 0.25, sunR / dist);
    for (const e of this.els) {
      const s = e.sprite;
      s.position.set(sx * e.at, sy * e.at, -1);
      // on the sun itself: less once the sun fills a good part of the view (its own surface shows)
      const k = e.at === 1 ? 1 - 0.85 * big : 0.8 + 1.0 * centre;
      s.scale.set(e.size, e.size * (e.aspect ?? 1), 1);
      (s.material as THREE.SpriteMaterial).opacity = e.opacity * this.vis * k;
      if (e.spin) (s.material as THREE.SpriteMaterial).rotation = roll * 0.5;
    }
  }

  /** Draw over what's already on screen. */
  render(renderer: THREE.WebGLRenderer) {
    if (!this.scene.visible) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
    renderer.autoClear = auto;
  }
}
