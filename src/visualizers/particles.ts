import type { Visualizer, Size, FrameData } from './types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  hue: number;
  band: number; // which frequency band this particle reacts to, 0..1
}

const PARTICLE_COUNT = 90;

/** Soft glowing particles that drift and pulse with volume/frequency, like WMP's "Ambience". */
export class ParticlesVisualizer implements Visualizer {
  id = 'particles';
  name = 'Ambient Particles';

  private ctx: CanvasRenderingContext2D | null = null;
  private size: Size = { w: 0, h: 0 };
  private particles: Particle[] = [];
  private smoothedVolume = 0;

  init(ctx: CanvasRenderingContext2D, size: Size): void {
    this.ctx = ctx;
    this.size = size;
    this.particles = Array.from({ length: PARTICLE_COUNT }, () => this.spawn());
    this.smoothedVolume = 0;
  }

  private spawn(): Particle {
    const { w, h } = this.size;
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      baseRadius: 4 + Math.random() * 10,
      hue: Math.random() * 360,
      band: Math.random(),
    };
  }

  resize(size: Size): void {
    this.size = size;
  }

  render(frame: FrameData, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h } = this.size;

    // Trail effect via a translucent clear.
    ctx.fillStyle = 'rgba(4, 4, 12, 0.18)';
    ctx.fillRect(0, 0, w, h);

    this.smoothedVolume += (frame.volume - this.smoothedVolume) * Math.min(1, dt * 6);

    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const binIndex = Math.floor(p.band * frame.freq.length * 0.6);
      const bandEnergy = frame.freq[binIndex] / 255;

      // Drift, gently pulled outward from center by volume.
      const cx = w / 2;
      const cy = h / 2;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const push = (this.smoothedVolume * 40 + bandEnergy * 20) * dt;
      p.x += (p.vx + (dx / dist) * push) * dt;
      p.y += (p.vy + (dy / dist) * push) * dt;

      // Wrap around edges.
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20;
      if (p.y > h + 20) p.y = -20;

      const radius = p.baseRadius * (0.6 + bandEnergy * 1.8 + this.smoothedVolume * 1.5);
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, `hsla(${p.hue}, 90%, 70%, 0.9)`);
      gradient.addColorStop(1, `hsla(${p.hue}, 90%, 60%, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    this.ctx = null;
    this.particles = [];
  }
}
