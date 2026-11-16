// Code-generated WebAudio sound: every effect is synthesised locally, no files.
// Gunshots fall off with distance; a quiet wind + pad loop keeps the game
// from ever being silent. All nodes are created on demand and released.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.ambientStarted = false;
    this.noiseBuffer = null;
  }

  // Must be called from a user gesture at least once (start button / click).
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // Distance falloff: 1.0 at 0 m, ~0.25 at 30 m, ~0.08 at 60 m.
  gainForDistance(dist) {
    return Math.max(0.05, 1 / (1 + dist * 0.09));
  }

  _noise(dur, filterType, freq, gainVal, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, type, gainVal, slideTo = null, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(kind, dist = 0) {
    if (!this.ctx) return;
    const g = this.gainForDistance(dist);
    if (kind === 'shotgun') {
      this._noise(0.28, 'lowpass', 900, 0.9 * g);
      this._tone(90, 0.22, 'sine', 0.7 * g, 45);
    } else if (kind === 'sniper') {
      this._noise(0.32, 'bandpass', 1400, 0.8 * g);
      this._tone(140, 0.3, 'sine', 0.6 * g, 50);
    } else if (kind === 'smg') {
      this._noise(0.09, 'bandpass', 2200, 0.5 * g);
      this._tone(170, 0.08, 'square', 0.22 * g, 90);
    } else if (kind === 'pistol') {
      this._noise(0.12, 'bandpass', 1800, 0.6 * g);
      this._tone(150, 0.1, 'square', 0.3 * g, 70);
    } else {
      this._noise(0.14, 'bandpass', 1600, 0.7 * g);
      this._tone(130, 0.12, 'square', 0.35 * g, 60);
    }
  }

  dryClick() { this._tone(1400, 0.05, 'square', 0.18); }
  reload() {
    this._tone(900, 0.05, 'square', 0.15);
    this._tone(600, 0.05, 'square', 0.15, null, 0.25);
    this._tone(1100, 0.06, 'square', 0.2, null, 0.55);
  }
  hit(head = false) {
    this._tone(head ? 1750 : 1250, 0.07, 'sine', 0.35);
  }
  kill() {
    this._tone(880, 0.09, 'sine', 0.3);
    this._tone(1318, 0.12, 'sine', 0.3, null, 0.09);
  }
  hurt() {
    this._tone(180, 0.15, 'sine', 0.4, 90);
    this._noise(0.1, 'lowpass', 500, 0.25);
  }
  beep(urgent = false) {
    this._tone(urgent ? 1500 : 1050, urgent ? 0.12 : 0.09, 'sine', 0.35);
  }
  plantTick() { this._tone(2000, 0.04, 'square', 0.12); }
  plantDone() {
    this._tone(700, 0.1, 'square', 0.25);
    this._tone(1050, 0.14, 'square', 0.25, null, 0.1);
  }
  explosion() {
    this._noise(1.4, 'lowpass', 320, 1.0);
    this._tone(70, 1.1, 'sine', 0.9, 28);
    this._noise(0.5, 'highpass', 2500, 0.3);
  }
  flashbang() {
    this._tone(3200, 1.2, 'sine', 0.22, 2800);
    this._noise(0.4, 'highpass', 4000, 0.2);
  }
  buy() { this._tone(990, 0.08, 'sine', 0.3); this._tone(1320, 0.1, 'sine', 0.3, null, 0.08); }
  denied() { this._tone(220, 0.16, 'square', 0.25, 160); }
  roundWin() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.3, null, i * 0.13));
  }
  roundLose() {
    [392, 330, 262, 196].forEach((f, i) => this._tone(f, 0.25, 'triangle', 0.3, null, i * 0.14));
  }
  footstep() { this._noise(0.05, 'lowpass', 700, 0.06); }

  // Quiet desert wind + a soft pad, started once, looped forever.
  startAmbient() {
    if (!this.ctx || this.ambientStarted) return;
    this.ambientStarted = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    lfo.start();
    // Slow two-note pad, very quiet.
    [110, 164.8, 220].forEach((freq) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const og = this.ctx.createGain();
      og.gain.value = 0.018;
      o.connect(og);
      og.connect(this.master);
      o.start();
    });
  }
}
