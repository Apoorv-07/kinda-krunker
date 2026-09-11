// ---------------------------------------------------------------------------
// Synthesized sound effects + music loop via WebAudio. No audio assets needed.
// ---------------------------------------------------------------------------

export type SfxName =
  | "shoot_ar" | "shoot_smg" | "shoot_shotgun" | "shoot_sniper"
  | "hit" | "headshot" | "kill" | "dmg" | "die"
  | "reload" | "jump" | "land" | "pad" | "pickup"
  | "count" | "go" | "win" | "lose" | "ui" | "empty" | "slide";

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private quietBus: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private currentDest: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  volume = 0.7;
  muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.quietBus = this.ctx.createGain();
      this.quietBus.gain.value = 0.3;
      this.quietBus.connect(this.master);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.02);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  private noiseBuffer(dur: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private tone(
    freq: number, type: OscillatorType, dur: number,
    gain: number, freqEnd?: number, delay = 0, dest?: AudioNode,
  ) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest ?? this.currentDest ?? this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterFreq: number, type: BiquadFilterType = "lowpass", delay = 0, q = 0.8) {
    if (!this.ctx || !this.master) return;
    const buf = this.noiseBuffer(dur + 0.05);
    if (!buf) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.currentDest ?? this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  play(name: SfxName, quiet = false) {
    if (!this.ctx || this.muted) return;
    this.currentDest = quiet ? this.quietBus : null;
    switch (name) {
      case "shoot_ar":
        this.noise(0.09, 0.5, 3200, "lowpass");
        this.tone(180, "square", 0.08, 0.22, 60);
        break;
      case "shoot_smg":
        this.noise(0.06, 0.36, 3800, "lowpass");
        this.tone(240, "square", 0.05, 0.14, 90);
        break;
      case "shoot_shotgun":
        this.noise(0.28, 0.65, 1600, "lowpass");
        this.tone(120, "sawtooth", 0.22, 0.3, 40);
        break;
      case "shoot_sniper":
        this.noise(0.4, 0.7, 2400, "bandpass");
        this.tone(90, "sawtooth", 0.35, 0.32, 30);
        this.tone(1800, "sine", 0.1, 0.12, 400);
        break;
      case "hit":
        this.tone(1300, "sine", 0.05, 0.28, 900);
        this.noise(0.04, 0.18, 4000, "highpass");
        break;
      case "headshot":
        this.tone(1500, "sine", 0.06, 0.3, 1900);
        this.tone(2000, "sine", 0.08, 0.22, 1400, 0.04);
        break;
      case "kill":
        this.tone(660, "square", 0.07, 0.16);
        this.tone(880, "square", 0.07, 0.16, undefined, 0.07);
        this.tone(1320, "square", 0.1, 0.16, undefined, 0.14);
        break;
      case "dmg":
        this.noise(0.12, 0.4, 500, "lowpass");
        this.tone(160, "sine", 0.14, 0.34, 70);
        break;
      case "die":
        this.tone(400, "sawtooth", 0.5, 0.3, 50);
        this.noise(0.4, 0.3, 800, "lowpass");
        break;
      case "reload":
        this.noise(0.05, 0.25, 2500, "highpass");
        this.noise(0.05, 0.25, 1800, "highpass", 0.35);
        this.noise(0.06, 0.3, 2200, "highpass", 0.75);
        break;
      case "jump":
        this.tone(300, "sine", 0.1, 0.14, 520);
        break;
      case "land":
        this.noise(0.08, 0.22, 600, "lowpass");
        break;
      case "pad":
        this.tone(220, "sine", 0.3, 0.24, 880);
        this.tone(440, "sine", 0.25, 0.12, 1320, 0.05);
        break;
      case "pickup":
        this.tone(520, "square", 0.07, 0.16);
        this.tone(780, "square", 0.09, 0.16, undefined, 0.06);
        break;
      case "count":
        this.tone(440, "sine", 0.12, 0.25);
        break;
      case "go":
        this.tone(660, "sine", 0.1, 0.28);
        this.tone(990, "sine", 0.22, 0.26, undefined, 0.08);
        break;
      case "win":
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, "square", 0.18, 0.18, undefined, i * 0.12));
        break;
      case "lose":
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, "sawtooth", 0.2, 0.16, undefined, i * 0.13));
        break;
      case "ui":
        this.tone(700, "sine", 0.05, 0.16, 900);
        break;
      case "empty":
        this.tone(2200, "sine", 0.03, 0.12, 1800);
        break;
      case "slide":
        this.noise(0.35, 0.14, 900, "bandpass");
        break;
    }
  }

  // --- simple driving music loop ------------------------------------------
  startMusic() {
    this.ensure();
    if (!this.ctx || this.musicTimer !== null) return;
    const bass = [55, 55, 65.4, 49];
    const lead = [220, 0, 261.6, 0, 329.6, 0, 261.6, 0];
    const stepDur = 0.22;
    this.musicStep = 0;
    const tick = () => {
      if (!this.ctx || !this.musicGain) return;
      const bar = Math.floor(this.musicStep / 8) % 4;
      const beat = this.musicStep % 8;
      if (beat === 0 || beat === 3 || beat === 6) {
        this.tone(bass[bar], "sawtooth", 0.2, 0.5, undefined, 0, this.musicGain);
      }
      const lf = lead[beat];
      if (lf > 0) this.tone(lf, "square", 0.16, 0.14, undefined, 0, this.musicGain);
      if (beat === 7 && Math.random() > 0.4) {
        this.noise(0.05, 0.12, 5000, "highpass", 0, 1.2);
      }
      this.musicStep++;
    };
    tick();
    this.musicTimer = window.setInterval(tick, stepDur * 1000);
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}

export const sfx = new SoundEngine();
