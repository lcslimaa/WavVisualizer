import type { Visualizer, Size, FrameData } from './types';

/** Classic spectrum-analyzer bars, mirrored top/bottom like WMP's "Bars". */
export class BarsVisualizer implements Visualizer {
  id = 'bars';
  name = 'Bars';

  private ctx: CanvasRenderingContext2D | null = null;
  private size: Size = { w: 0, h: 0 };
  private peaks: number[] = [];

  init(ctx: CanvasRenderingContext2D, size: Size): void {
    this.ctx = ctx;
    this.size = size;
    this.peaks = [];
  }

  resize(size: Size): void {
    this.size = size;
  }

  render(frame: FrameData, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h } = this.size;

    ctx.fillStyle = 'rgba(6, 8, 16, 0.35)';
    ctx.fillRect(0, 0, w, h);

    // Use the lower ~2/3 of the frequency bins — the top bins are usually near-silent.
    const usableBins = Math.floor(frame.freq.length * 0.7);
    const barCount = Math.min(64, usableBins);
    const binsPerBar = Math.max(1, Math.floor(usableBins / barCount));
    const gap = 3;
    const barWidth = w / barCount - gap;

    if (this.peaks.length !== barCount) {
      this.peaks = new Array(barCount).fill(0);
    }

    const midY = h / 2;
    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      const start = i * binsPerBar;
      for (let j = 0; j < binsPerBar; j++) sum += frame.freq[start + j] ?? 0;
      const avg = sum / binsPerBar / 255; // 0..1

      // Decay the peak slowly so bars feel springy rather than jittery.
      this.peaks[i] = Math.max(avg, this.peaks[i] - dt * 0.6);

      const barH = this.peaks[i] * (h * 0.45);
      const x = i * (barWidth + gap);
      const hue = 200 + (i / barCount) * 120;

      const gradient = ctx.createLinearGradient(0, midY - barH, 0, midY + barH);
      gradient.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.95)`);
      gradient.addColorStop(1, `hsla(${hue}, 90%, 45%, 0.95)`);
      ctx.fillStyle = gradient;

      ctx.fillRect(x, midY - barH, barWidth, barH);
      ctx.fillRect(x, midY, barWidth, barH);
    }
  }

  dispose(): void {
    this.ctx = null;
  }
}
