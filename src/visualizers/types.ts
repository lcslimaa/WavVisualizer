import type { FrameData } from '../audio/capture';

export interface Size {
  w: number;
  h: number;
}

export interface Visualizer {
  id: string;
  name: string;
  /** Called once when the preset becomes active. */
  init(ctx: CanvasRenderingContext2D, size: Size): void;
  /** Called whenever the canvas resizes while this preset is active. */
  resize(size: Size): void;
  /** Called once per animation frame while this preset is active. */
  render(frame: FrameData, dt: number): void;
  /** Called when switching away from this preset. */
  dispose(): void;
}

export type { FrameData };
