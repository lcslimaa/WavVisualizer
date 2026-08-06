/**
 * Butterchurn ships no TypeScript types. These ambient declarations cover
 * only the surface this project actually uses — see
 * https://github.com/jberg/butterchurn for the full (untyped) API.
 */
declare module 'butterchurn' {
  export interface ButterchurnVisualizerOptions {
    width: number;
    height: number;
    pixelRatio?: number;
    textureRatio?: number;
  }

  /** A parsed Butterchurn preset JSON object (baseVals/shapes/waves/eqs/warp/comp shaders). */
  export type ButterchurnPreset = Record<string, unknown>;

  export interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void;
    disconnectAudio(node: AudioNode): void;
    loadPreset(preset: ButterchurnPreset, blendSeconds: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }

  export interface Butterchurn {
    createVisualizer(
      audioContext: AudioContext,
      canvas: HTMLCanvasElement,
      options: ButterchurnVisualizerOptions
    ): ButterchurnVisualizer;
  }

  // The real default export, at runtime, is double-wrapped — see the
  // unwrap in src/butterchurn/engine.ts for why this type is looser than
  // the logical API.
  const butterchurn: Butterchurn | { default: Butterchurn };
  export default butterchurn;
}
