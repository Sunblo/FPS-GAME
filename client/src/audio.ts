// Procedural WebAudio SFX - no external samples, everything synthesized.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      // white noise buffer
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }
  setMuted(m: boolean): void { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterType: BiquadFilterType, f0: number, f1?: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  gunshot(w: string, gain: number): void {
    if (!this.ctx) return;
    const g = Math.min(1, gain);
    if (w === 'knife') { this.swish(0.3 * g); return; }
    const long = w === 'obliterator' || w === 'raptor' || w === 'nova-x';
    const short = w === 'pax' || w === 'mirage' || w === 'shadow';
    const dur = long ? 0.4 : short ? 0.12 : 0.2;
    this.noise(dur, g, 'bandpass', long ? 900 : 1600, 300);
    this.noise(dur * 0.5, g * 0.7, 'highpass', 3000, 6000);
    this.tone(long ? 120 : 180, 40, dur, g * 0.7, 'sine');
    if (Math.random() < 0.4) this.tone(2400, 2200, 0.03, g * 0.2, 'square');
  }
  dry(gain = 0.5): void { this.tone(700, 500, 0.05, gain, 'square'); }
  reload(): void {
    this.tone(1200, 900, 0.02, 0.2, 'square', 0);
    this.tone(900, 600, 0.03, 0.25, 'square', 0.25);
    this.tone(1500, 1200, 0.04, 0.3, 'square', 0.7);
  }
  reloadDone(): void { this.tone(700, 1300, 0.06, 0.2, 'square'); }
  footstep(run: boolean): void {
    const f = 90 + Math.random() * 40;
    this.noise(0.04, run ? 0.14 : 0.08, 'lowpass', f, 40);
  }
  land(gain = 0.4): void { this.noise(0.08, gain, 'lowpass', 200, 60); }
  hurt(): void { this.tone(180, 90, 0.16, 0.5, 'sawtooth'); }
  headhit(): void { this.tone(1900, 2400, 0.05, 0.35, 'square'); }
  killmark(): void { this.tone(1500, 2200, 0.07, 0.22, 'sine'); this.tone(2200, 3000, 0.08, 0.14, 'sine', 0.06); }
  switch(): void { this.tone(600, 900, 0.03, 0.12, 'square'); }
  pick(): void { this.tone(900, 500, 0.05, 0.2, 'square'); }
  buy(): void { this.tone(800, 1200, 0.06, 0.2, 'square'); }
  deny(): void { this.tone(300, 180, 0.12, 0.25, 'square'); }
  throwSnd(): void { this.noise(0.12, 0.12, 'bandpass', 2000, 900); }
  plantBeep(up: boolean): void { this.tone(up ? 1700 : 900, up ? 1700 : 900, 0.05, 0.12, 'square'); }
  defuseBeep(): void { this.tone(1300, 1300, 0.04, 0.1, 'square'); }
  bombPlanted(): void { this.tone(500, 300, 0.5, 0.4, 'sawtooth'); }
  boom(gain = 1): void {
    this.noise(1.6, gain * 0.9, 'lowpass', 160, 30);
    this.tone(60, 24, 1.2, gain * 0.8, 'sine');
  }
  smokePop(gain = 0.5): void { this.noise(0.5, gain * 0.4, 'lowpass', 500, 80); }
  flashPop(): void { this.noise(0.06, 0.25, 'highpass', 4000, 6000); this.tone(2000, 3500, 0.05, 0.1, 'sine'); }
  fragPop(gain = 0.6): void { this.noise(0.8, gain, 'lowpass', 240, 40); }
  roundStart(): void { this.tone(220, 220, 0.5, 0.3, 'sawtooth', 0); this.tone(330, 330, 0.5, 0.2, 'sawtooth', 0.12); }
  roundWin(): void { this.tone(600, 900, 0.18, 0.3, 'sine'); this.tone(900, 1400, 0.22, 0.2, 'sine', 0.15); }
  roundLose(): void { this.tone(400, 200, 0.4, 0.25, 'sawtooth'); }
  swish(gain = 0.3): void { this.noise(0.09, gain, 'highpass', 1500, 800); }
  chat(): void { this.tone(700, 800, 0.05, 0.1, 'square'); }
}
