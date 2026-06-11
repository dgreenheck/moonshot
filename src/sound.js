// Procedural WebAudio: engine rumble, staging thunks, explosions, warnings.

export class SoundFX {
  constructor() { this.ctx = null; }

  ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      // looped noise buffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // brownish noise
        last = (last + (Math.random() * 2 - 1) * 0.18) * 0.985;
        data[i] = last * 2.4;
      }
      this.noiseBuf = buf;

      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      src.connect(this.engineFilter).connect(this.engineGain).connect(ctx.destination);
      src.start();

      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      const wsrc = ctx.createBufferSource();
      wsrc.buffer = buf; wsrc.loop = true; wsrc.playbackRate.value = 1.7;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 0.6;
      wsrc.connect(wf).connect(this.windGain).connect(ctx.destination);
      wsrc.start();
    } catch { this.ctx = null; }
  }

  setEngine(throttleThrust01, atmo01) {
    if (!this.ctx) return;
    const g = throttleThrust01 * (0.10 + 0.16 * atmo01);
    this.engineGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08);
    this.engineFilter.frequency.setTargetAtTime(220 + 700 * throttleThrust01, this.ctx.currentTime, 0.1);
  }

  setWind(qDyn) {
    if (!this.ctx) return;
    const g = Math.min(0.14, qDyn / 28000 * 0.14);
    this.windGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.15);
  }

  oneShot(dur, freq, type = 'lowpass', vol = 0.4) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  stage() { this.oneShot(0.4, 500, 'lowpass', 0.5); }
  explosion() { this.oneShot(1.6, 240, 'lowpass', 0.9); }
  chute() { this.oneShot(0.5, 1800, 'highpass', 0.25); }
  warn() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.06, this.ctx.currentTime);
    g.gain.setValueAtTime(0, this.ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.06, this.ctx.currentTime + 0.24);
    g.gain.setValueAtTime(0, this.ctx.currentTime + 0.36);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + 0.4);
  }
}
