import type { Visualizer } from './types';
import { BarsVisualizer } from './bars';
import { ParticlesVisualizer } from './particles';
import { KaleidoscopeVisualizer } from './kaleidoscope';

/** Ordered list of available visualizers — order determines preset-cycling order. */
export const visualizers: Visualizer[] = [
  new BarsVisualizer(),
  new ParticlesVisualizer(),
  new KaleidoscopeVisualizer(),
];
