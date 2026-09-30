import { catOf } from '../../shared/weapons.ts';

const SAMPLES: Record<string, string> = {
  pistol: '/sfx/blaster.ogg',
  rifle: '/sfx/blaster_repeater.ogg',
  jump: '/sfx/jump_a.ogg',
  land: '/sfx/land.ogg',
  walk: '/sfx/walking.ogg',
  switch: '/sfx/weapon_change.ogg',
  hurt: '/sfx/enemy_hurt.ogg',
  boom: '/sfx/enemy_destroy.ogg',
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      void this.prefetch();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }

  private async prefetch(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(Object.entries(SAMPLES).map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(key, buf);
      } catch { /* keep synth fallback */ }
    }));
  }

  private sample(key: string, gain: number, rate = 1): boolean {
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.buffers.get(key);
    if (!ctx || !master || !buf || gain <= 0) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = Math.min(1.4, gain);
    src.connect(g).connect(master);
    src.start();
    return true;
  }

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
    if (w === 'knife') { this.swish(0.35 * g); return; }
    const cat = catOf(w);
    const rate = 0.92 + Math.random() * 0.12;
    if (cat === 'pistol' || cat === 'smg') {
      if (this.sample('pistol', g * 0.95, rate + (cat === 'smg' ? 0.08 : 0))) return;
    } else if (this.sample('rifle', g * (cat === 'shotgun' || cat === 'sniper' ? 1.15 : 1), rate * (cat === 'shotgun' ? 0.82 : 1))) {
      return;
    }
    const long = cat === 'sniper' || cat === 'lmg' || cat === 'shotgun';
    const short = cat === 'pistol';
    const dur = cat === 'shotgun' ? 0.35 : long ? 0.38 : short ? 0.11 : 0.18;
    this.noise(dur, g * (cat === 'shotgun' ? 1.05 : 0.95), 'bandpass', cat === 'shotgun' ? 700 : long ? 850 : 1700, cat === 'shotgun' ? 180 : 280);
    this.noise(dur * 0.45, g * 0.65, 'highpass', 2800, 6500);
    this.tone(cat === 'shotgun' ? 90 : long ? 110 : 190, 36, dur, g * 0.72, 'sine');
  }

  dry(gain = 0.5): void { this.tone(700, 500, 0.05, gain, 'square'); }
  reload(): void {
    this.tone(220, 160, 0.05, 0.18, 'triangle', 0);
    this.tone(180, 140, 0.06, 0.22, 'triangle', 0.22);
    this.tone(320, 260, 0.05, 0.16, 'sine', 0.68);
  }
  reloadDone(): void { this.tone(420, 680, 0.07, 0.16, 'triangle'); }
  footstep(run: boolean): void {
    if (this.sample('walk', run ? 0.22 : 0.14, run ? 1.15 : 0.92)) return;
    const f = 90 + Math.random() * 40;
    this.noise(0.04, run ? 0.14 : 0.08, 'lowpass', f, 40);
  }
  land(gain = 0.4): void {
    if (this.sample('land', gain * 0.9, 0.95 + Math.random() * 0.08)) return;
    this.noise(0.08, gain, 'lowpass', 200, 60);
  }
  hurt(): void {
    if (this.sample('hurt', 0.7, 0.96 + Math.random() * 0.08)) return;
    this.tone(180, 90, 0.16, 0.5, 'sawtooth');
  }
  headhit(): void { this.tone(1900, 2400, 0.05, 0.28, 'sine'); }
  killmark(): void { this.tone(880, 1320, 0.08, 0.2, 'sine'); this.tone(1320, 1760, 0.09, 0.12, 'sine', 0.07); }
  hitmark(hs = false): void {
    if (hs) { this.tone(1600, 2100, 0.05, 0.22, 'sine'); this.tone(2100, 2600, 0.05, 0.12, 'sine', 0.04); }
    else this.tone(1200, 1600, 0.04, 0.14, 'sine');
  }
  switch(): void {
    if (this.sample('switch', 0.55, 1)) return;
    this.tone(420, 640, 0.04, 0.12, 'triangle');
  }
  pick(): void { this.tone(640, 420, 0.06, 0.16, 'triangle'); }
  buy(): void { this.tone(520, 780, 0.07, 0.16, 'sine'); }
  deny(): void { this.tone(220, 140, 0.12, 0.2, 'triangle'); }
  throwSnd(): void { this.noise(0.12, 0.12, 'bandpass', 2000, 900); }
  plantBeep(up: boolean): void { this.tone(up ? 1400 : 780, up ? 1400 : 780, 0.05, 0.1, 'sine'); }
  defuseBeep(): void { this.tone(1100, 1100, 0.04, 0.08, 'sine'); }
  bombPlanted(): void { this.tone(360, 220, 0.45, 0.28, 'triangle'); }
  boom(gain = 1): void {
    if (this.sample('boom', gain * 0.95, 0.85)) return;
    this.noise(1.6, gain * 0.9, 'lowpass', 160, 30);
    this.tone(60, 24, 1.2, gain * 0.8, 'sine');
  }
  smokePop(gain = 0.5): void { this.noise(0.5, gain * 0.4, 'lowpass', 500, 80); }
  flashPop(): void { this.noise(0.06, 0.25, 'highpass', 4000, 6000); this.tone(2000, 3500, 0.05, 0.1, 'sine'); }
  fragPop(gain = 0.6): void {
    if (this.sample('boom', gain * 0.8, 1.05)) return;
    this.noise(0.8, gain, 'lowpass', 240, 40);
  }
  roundStart(): void { this.tone(220, 220, 0.4, 0.22, 'triangle', 0); this.tone(330, 330, 0.4, 0.14, 'triangle', 0.12); }
  roundWin(): void { this.tone(520, 780, 0.18, 0.22, 'sine'); this.tone(780, 1040, 0.22, 0.16, 'sine', 0.15); }
  roundLose(): void { this.tone(320, 160, 0.4, 0.2, 'triangle'); }
  swish(gain = 0.3): void { this.noise(0.09, gain, 'highpass', 1500, 800); }
  chat(): void { this.tone(620, 740, 0.05, 0.08, 'sine'); }
}
