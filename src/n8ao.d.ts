/** The parts of n8ao (screen-space ambient occlusion, src/world/post.ts) this game uses: the package ships no types. */
declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
  import { Pass } from 'three/addons/postprocessing/Pass.js';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    halfRes: boolean;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
  }

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra' | 'Neural-Performance' | 'Neural-Low' | 'Neural-Medium' | 'Neural-High'): void;
    setSize(width: number, height: number): void;
    render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void;
    dispose(): void;
  }
}
