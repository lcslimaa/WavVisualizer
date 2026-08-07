/**
 * Audio capture pipeline.
 *
 * Browsers have no direct OS-level "loopback" API, so the practical way to
 * visualize whatever is playing on the system is to ask the user to share a
 * tab/window/screen via getDisplayMedia and grab its audio track. We only
 * care about audio, so the (mandatory) video track is stopped immediately.
 *
 * Reliable support: Chrome/Edge (Chromium). Firefox/Safari support for
 * sharing system/tab *audio* is inconsistent or missing.
 */

export interface FrameData {
  /** Frequency-domain magnitudes, 0-255 per bin. */
  freq: Uint8Array;
  /** Time-domain waveform samples, 0-255 centered on 128. */
  wave: Uint8Array;
  /** RMS volume for this frame, roughly 0-1. */
  volume: number;
}

export class AudioCapture {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  // Typed explicitly as Uint8Array<ArrayBuffer> — AnalyserNode's DOM typings
  // require the non-resizable ArrayBuffer-backed variant, which plain
  // `Uint8Array` no longer guarantees under TS's newer generic typings.
  private freqBuf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private waveBuf: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  get isActive(): boolean {
    return this.analyser !== null;
  }

  /**
   * Prompts the user to share a tab/window/screen with audio, and wires up
   * the analysis pipeline. Throws if the user cancels or the browser denies
   * audio capture (e.g. shared a source without checking "Share audio").
   *
   * `preferCurrentTab` surfaces "This Tab" as a prominent, easy-to-pick
   * option in Chrome/Edge's share picker — useful when we've just mounted
   * something (like a SoundCloud embed) in this same tab. It does not skip
   * the picker outright, and browsers that don't support it just ignore the
   * option and show the normal picker.
   */
  async start(opts: { fftSize?: number; preferCurrentTab?: boolean } = {}): Promise<void> {
    const { fftSize = 2048, preferCurrentTab = false } = opts;

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        "This browser doesn't support screen/tab audio capture. Try Chrome or Edge."
      );
    }

    // video: true is required by the spec even though we only want audio.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      ...(preferCurrentTab ? { preferCurrentTab: true } : {}),
    } as DisplayMediaStreamOptions);

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No audio was shared. Make sure to check "Share audio" in the picker.'
      );
    }

    // We don't render the shared video — stop it right away.
    stream.getVideoTracks().forEach((t) => t.stop());

    this.stop(); // tear down any previous session first

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    this.audioCtx = audioCtx;
    this.analyser = analyser;
    this.stream = stream;
    this.sourceNode = source;
    this.freqBuf = new Uint8Array(analyser.frequencyBinCount);
    this.waveBuf = new Uint8Array(analyser.fftSize);

    // If the user stops sharing from the browser's own UI, tear down cleanly.
    audioTracks[0].addEventListener('ended', () => this.stop());
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
    this.stream = null;
    this.sourceNode = null;
  }

  /**
   * The live AudioContext, for engines (like Butterchurn) that need to be
   * constructed against the same context our analysis pipeline runs on.
   * Only valid while `isActive` is true.
   */
  getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  /**
   * A raw AudioNode carrying the captured stream, for engines that want to
   * do their own analysis (e.g. Butterchurn's internal bass/mid/treb +
   * beat detection) rather than consuming our derived FrameData.
   */
  getSourceNode(): AudioNode | null {
    return this.sourceNode;
  }

  /** Reads the current frame. Reuses internal buffers — do not retain the arrays. */
  getFrameData(): FrameData | null {
    const analyser = this.analyser;
    if (!analyser) return null;

    analyser.getByteFrequencyData(this.freqBuf);
    analyser.getByteTimeDomainData(this.waveBuf);

    let sumSquares = 0;
    for (let i = 0; i < this.waveBuf.length; i++) {
      const centered = (this.waveBuf[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const volume = Math.sqrt(sumSquares / this.waveBuf.length);

    return { freq: this.freqBuf, wave: this.waveBuf, volume };
  }
}
