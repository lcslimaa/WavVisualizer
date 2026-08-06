import butterchurnImport from 'butterchurn';
import type { Butterchurn, ButterchurnPreset, ButterchurnVisualizer } from 'butterchurn';
import type { Size } from '../visualizers/types';

export type { ButterchurnPreset };

// Butterchurn's own webpack build double-wraps its default export
// (`{ __esModule: true, default: Butterchurn }` instead of `Butterchurn`
// itself), and Vite's dependency pre-bundling doesn't unwrap that extra
// layer for this package. Unwrap defensively rather than depend on
// bundler-internal behavior that isn't part of any public contract.
const butterchurn: Butterchurn =
  'createVisualizer' in butterchurnImport ? butterchurnImport : butterchurnImport.default;

export interface LoadedPreset {
  name: string;
  preset: ButterchurnPreset;
}

/**
 * Thin wrapper around Butterchurn's own visualizer instance. Unlike our
 * Canvas2D `Visualizer` plugins, Butterchurn owns a WebGL2 context entirely
 * and does its own internal audio analysis once connected to a raw
 * AudioNode — it is not fed FrameData per frame.
 */
export class ButterchurnEngine {
  private visualizer: ButterchurnVisualizer | null = null;
  private audioNode: AudioNode | null = null;

  get isInitialized(): boolean {
    return this.visualizer !== null;
  }

  /** (Re)creates the visualizer against a fresh AudioContext/AudioNode — call whenever capture (re)starts. */
  init(audioContext: AudioContext, canvas: HTMLCanvasElement, size: Size, audioNode: AudioNode): void {
    this.disconnectAudio();
    this.visualizer = butterchurn.createVisualizer(audioContext, canvas, {
      width: size.w,
      height: size.h,
    });
    this.audioNode = audioNode;
    this.visualizer.connectAudio(audioNode);
  }

  resize(size: Size): void {
    this.visualizer?.setRendererSize(size.w, size.h);
  }

  loadPreset(preset: ButterchurnPreset, blendSeconds = 0): void {
    this.visualizer?.loadPreset(preset, blendSeconds);
  }

  render(): void {
    this.visualizer?.render();
  }

  private disconnectAudio(): void {
    if (this.visualizer && this.audioNode) {
      this.visualizer.disconnectAudio(this.audioNode);
    }
    this.audioNode = null;
  }

  dispose(): void {
    this.disconnectAudio();
    this.visualizer = null;
  }
}
