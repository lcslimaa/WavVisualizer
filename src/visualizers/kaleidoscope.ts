import type { Visualizer, Size, FrameData } from './types';

const SEGMENTS = 10;
const WEDGE_ANGLE = (Math.PI * 2) / SEGMENTS;
const POINTS_PER_WEDGE = 40;

/** Radially mirrored, rotating pattern driven by the spectrum — like WMP's "Alchemy". */
export class KaleidoscopeVisualizer implements Visualizer {
  id = 'kaleidoscope';
  name = 'Kaleidoscope';

  private ctx: CanvasRenderingContext2D | null = null;
  private size: Size = { w: 0, h: 0 };
  private rotation = 0;
  private hue = 0;

  init(ctx: CanvasRenderingContext2D, size: Size): void {
    this.ctx = ctx;
    this.size = size;
    this.rotation = 0;
    this.hue = Math.random() * 360;
  }

  resize(size: Size): void {
    this.size = size;
  }

  render(frame: FrameData, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h } = this.size;
    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.min(w, h) * 0.48;

    ctx.fillStyle = 'rgba(3, 2, 10, 0.16)';
    ctx.fillRect(0, 0, w, h);

    this.rotation += dt * (0.15 + frame.volume * 0.9);
    this.hue = (this.hue + dt * 12) % 360;

    for (let i = 0; i < SEGMENTS; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(WEDGE_ANGLE * i + this.rotation);
      if (i % 2 === 1) ctx.scale(1, -1); // mirror alternate wedges for kaleidoscope symmetry
      this.drawWedge(ctx, frame, maxRadius);
      ctx.restore();
    }
  }

  /** Draws one wedge spanning [0, WEDGE_ANGLE), radiating from the origin. Caller sets the transform. */
  private drawWedge(ctx: CanvasRenderingContext2D, frame: FrameData, maxRadius: number): void {
    const usableBins = Math.floor(frame.freq.length * 0.5);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i < POINTS_PER_WEDGE; i++) {
      const t = i / (POINTS_PER_WEDGE - 1);
      const angle = t * WEDGE_ANGLE;
      const bin = Math.floor(t * usableBins);
      const energy = frame.freq[bin] / 255;
      const radius = maxRadius * (0.15 + energy * 0.85);
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.closePath();

    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, maxRadius);
    gradient.addColorStop(0, `hsla(${this.hue}, 95%, 65%, 0.85)`);
    gradient.addColorStop(1, `hsla(${(this.hue + 60) % 360}, 95%, 45%, 0.05)`);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  dispose(): void {
    this.ctx = null;
  }
}
