// Procedural Web Audio: bowstring creak and twang, arrow whoosh, impact thuds,
// surface-dependent footsteps, wind and birdsong. No asset files.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0, forestFactor: 1 };
    this.drawNodes = null;
    this.birdTimer = 2;
    this.masterVolume = 0.8;
    this.budget = 40;       // positional sounds allowed to start, refilled over time
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.enabled = true;
    this._startAmbience();
  }

  setListener(pos, yaw, forestFactor) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    this.listener.yaw = yaw; this.listener.forestFactor = forestFactor;
  }

  // Returns {gain, pan} for a world position, or null if inaudible.
  _spatial(pos, range = 60) {
    // never schedule nodes on a suspended context: they would pile up unplayed
    if (this.ctx.state !== 'running') return null;
    if (!pos) return { gain: 1, pan: 0 };   // the player's own sounds are never dropped
    // voice budget: cap how many positional sounds start per second so a 40-archer melee can't flood the graph
    if (this.budget < 1) return null;
    const L = this.listener;
    const dx = pos.x - L.x, dz = pos.z - L.z;
    const d = Math.hypot(dx, dz, (pos.y ?? L.y) - L.y);
    if (d > range) return null;
    const gain = 1 / (1 + d * 0.15) * (1 - d / range);
    if (gain < 0.02) return null;
    this.budget -= 1;
    // right vector of listener: (cos yaw, 0, -sin yaw)
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
    return { gain, pan };
  }

  _out(gain, pan) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  _noise(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.start(t, Math.random() * 1.5, dur + 0.05);
    return src;
  }

  _env(node, t, a, peak, dcy) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  drawStart(pos, isPlayer) {
    if (!this.enabled) return;
    const sp = this._spatial(pos, 25); if (!sp) return;
    const t = this.ctx.currentTime;
    const dur = 1.1;
    const out = this._out(sp.gain * (isPlayer ? 0.35 : 0.25), sp.pan);
    // creak: ticking filtered noise + low saw with rising pitch
    const n = this._noise(t, dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1400, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
    g.gain.linearRampToValueAtTime(0.25, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    // amplitude modulation for a "creak" texture
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = this.ctx.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg).connect(g.gain);
    lfo.start(t); lfo.stop(t + dur + 0.1);
    n.connect(bp).connect(g).connect(out);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(115, t + dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.06, t + 0.2);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    o.connect(lp).connect(og).connect(out);
    o.start(t); o.stop(t + dur + 0.1);
    if (isPlayer) this.drawNodes = { g, og, out };
  }

  stopDraw() {
    if (!this.drawNodes || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (const n of [this.drawNodes.g, this.drawNodes.og]) {
      n.gain.cancelScheduledValues(t);
      n.gain.setValueAtTime(n.gain.value || 0.0001, t);
      n.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    }
    this.drawNodes = null;
  }

  release(pos, power, isPlayer) {
    if (!this.enabled) return;
    const sp = this._spatial(pos, 70); if (!sp) return;
    const t = this.ctx.currentTime;
    const out = this._out(sp.gain * (isPlayer ? 0.9 : 0.7), sp.pan);
    // twang: plucked string = decaying triangle with pitch drop + bright click
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    const f = 95 + power * 60;
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const g = this.ctx.createGain();
    this._env(g, t, 0.004, 0.6, 0.35 + power * 0.2);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.7);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f * 3.1, t);
    const g2 = this.ctx.createGain();
    this._env(g2, t, 0.002, 0.2, 0.12);
    o2.connect(g2).connect(out);
    o2.start(t); o2.stop(t + 0.3);
    const n = this._noise(t, 0.05);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = this.ctx.createGain(); this._env(ng, t, 0.001, 0.4, 0.04);
    n.connect(hp).connect(ng).connect(out);
    // departing whoosh
    this.whoosh(pos, 0.5 * power + 0.2, 0.35);
  }

  whoosh(pos, vol = 1, dur = 0.3) {
    if (!this.enabled) return;
    const sp = this._spatial(pos, 30); if (!sp) return;
    const t = this.ctx.currentTime;
    const out = this._out(sp.gain * vol, sp.pan);
    const n = this._noise(t, dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, dur * 0.3, 0.9, dur * 0.7);
    n.connect(bp).connect(g).connect(out);
  }

  // knife: a short, sharp swish (the player's own is never dropped)
  swish(pos, isPlayer = false) {
    if (!this.enabled) return;
    this.whoosh(isPlayer ? null : pos, isPlayer ? 0.55 : 0.4, 0.16);
  }

  // kind: 'wood' | 'ground' | 'body' | 'rock' | 'canopy' | 'stab'
  impact(kind, pos, isNearPlayer = false) {
    if (!this.enabled) return;
    const sp = this._spatial(pos, 55); if (!sp) return;
    const t = this.ctx.currentTime;
    const out = this._out(sp.gain * (isNearPlayer ? 1.2 : 0.9), sp.pan);
    const tone = { wood: [220, 0.12, 900], ground: [90, 0.1, 400], body: [120, 0.12, 700], rock: [600, 0.06, 3000], canopy: [300, 0.05, 2500], stab: [140, 0.09, 1800] }[kind] || [150, 0.1, 600];
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(tone[0] * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(tone[0], t + 0.04);
    const g = this.ctx.createGain(); this._env(g, t, 0.002, kind === 'canopy' ? 0.1 : 0.7, tone[1]);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.3);
    const n = this._noise(t, 0.1);
    const lp = this.ctx.createBiquadFilter(); lp.type = kind === 'canopy' ? 'highpass' : 'lowpass'; lp.frequency.value = tone[2];
    const ng = this.ctx.createGain(); this._env(ng, t, 0.002, kind === 'canopy' ? 0.3 : 0.5, kind === 'canopy' ? 0.15 : 0.08);
    n.connect(lp).connect(ng).connect(out);
    if (kind === 'wood') {
      // arrow shaft quiver after sticking in wood
      const q = this.ctx.createOscillator();
      q.type = 'square'; q.frequency.value = 38;
      const qg = this.ctx.createGain(); this._env(qg, t + 0.01, 0.005, 0.05, 0.25);
      const ql = this.ctx.createBiquadFilter(); ql.type = 'lowpass'; ql.frequency.value = 300;
      q.connect(ql).connect(qg).connect(out);
      q.start(t); q.stop(t + 0.4);
    }
  }

  // surface: 'forest' | 'grass'
  footstep(surface, vol = 1, landing = false, pos = null) {
    if (!this.enabled) return;
    const sp = this._spatial(pos, 28); if (!sp) return;
    const t = this.ctx.currentTime;
    const out = this._out(sp.gain * vol * 0.32, sp.pan);
    if (surface === 'forest') {
      // leaf litter crunch: several tiny high crackles plus a dull thump
      for (let k = 0; k < 4; k++) {
        const tt = t + k * 0.012 + Math.random() * 0.01;
        const n = this._noise(tt, 0.03);
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
        bp.frequency.value = 2000 + Math.random() * 3000;
        const g = this.ctx.createGain(); this._env(g, tt, 0.001, 0.35, 0.025 + Math.random() * 0.02);
        n.connect(bp).connect(g).connect(out);
      }
      const n = this._noise(t, 0.08);
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 350;
      const g = this.ctx.createGain(); this._env(g, t, 0.003, landing ? 0.9 : 0.5, 0.07);
      n.connect(lp).connect(g).connect(out);
    } else {
      // grass: soft swish
      const n = this._noise(t, 0.16);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(1800, t); bp.frequency.linearRampToValueAtTime(900, t + 0.14);
      const g = this.ctx.createGain(); this._env(g, t, 0.03, landing ? 0.6 : 0.35, 0.12);
      n.connect(bp).connect(g).connect(out);
      const n2 = this._noise(t, 0.06);
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      const g2 = this.ctx.createGain(); this._env(g2, t, 0.004, landing ? 0.7 : 0.3, 0.05);
      n2.connect(lp).connect(g2).connect(out);
    }
  }

  pickup() {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const out = this._out(0.25, 0);
    for (let k = 0; k < 3; k++) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = 900 + k * 260;
      const g = this.ctx.createGain(); this._env(g, t + k * 0.04, 0.003, 0.4, 0.05);
      o.connect(g).connect(out); o.start(t + k * 0.04); o.stop(t + k * 0.04 + 0.1);
    }
  }

  // cloth rustle while winding a bandage
  bandage() {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    const out = this._out(0.3, 0);
    for (let k = 0; k < 6; k++) {
      const t = t0 + k * 0.45 + Math.random() * 0.1;
      const n = this._noise(t, 0.25);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7; bp.frequency.value = 2500 + Math.random() * 1500;
      const g = this.ctx.createGain(); this._env(g, t, 0.06, 0.5, 0.18);
      n.connect(bp).connect(g).connect(out);
    }
  }

  // soft rising chime when healing from a herb
  heal() {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const out = this._out(0.22, 0);
    [523, 659, 784, 1047].forEach((f, k) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain(); this._env(g, t + k * 0.07, 0.01, 0.5, 0.45);
      o.connect(g).connect(out); o.start(t + k * 0.07); o.stop(t + k * 0.07 + 0.6);
    });
  }

  // low-health heartbeat: two muffled thumps
  heartbeat() {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const out = this._out(0.55, 0);
    for (const [dt, v] of [[0, 1], [0.16, 0.7]]) {
      const o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.12);
      const g = this.ctx.createGain(); this._env(g, t + dt, 0.01, v, 0.14);
      o.connect(g).connect(out); o.start(t + dt); o.stop(t + dt + 0.25);
    }
  }

  hitTick(headshot) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const out = this._out(0.3, 0);
    const o = this.ctx.createOscillator();
    o.type = 'square'; o.frequency.value = headshot ? 1500 : 1000;
    const g = this.ctx.createGain(); this._env(g, t, 0.002, 0.3, headshot ? 0.12 : 0.06);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.2);
  }

  _startAmbience() {
    // gentle wind: looped low-passed noise with slow gain modulation
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.05;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = this.ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg).connect(this.windGain.gain);
    src.connect(lp).connect(this.windGain).connect(this.master);
    src.start(); lfo.start();
  }

  // One bird: a short phrase of FM-modulated chirps, randomly panned and distant.
  _bird() {
    const t = this.ctx.currentTime + 0.05;
    const pan = Math.random() * 2 - 1;
    const forest = this.listener.forestFactor;
    const vol = (0.03 + Math.random() * 0.05) * (0.45 + forest * 0.55);
    const out = this._out(vol, pan);
    const type = Math.floor(Math.random() * 3);
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2200 + Math.random() * 2200;
    let tt = t;
    for (let k = 0; k < notes; k++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const dur = type === 0 ? 0.06 : type === 1 ? 0.12 : 0.04;
      const f0 = base * (type === 2 ? 1 : 1 + (Math.random() - 0.3) * 0.3);
      o.frequency.setValueAtTime(f0, tt);
      if (type === 1) o.frequency.exponentialRampToValueAtTime(f0 * 0.6, tt + dur);
      else o.frequency.exponentialRampToValueAtTime(f0 * 1.35, tt + dur);
      const fm = this.ctx.createOscillator(); fm.frequency.value = 40 + Math.random() * 60;
      const fg = this.ctx.createGain(); fg.gain.value = f0 * 0.08;
      fm.connect(fg).connect(o.frequency);
      const g = this.ctx.createGain(); this._env(g, tt, 0.008, 0.8, dur);
      o.connect(g).connect(out);
      o.start(tt); o.stop(tt + dur + 0.05); fm.start(tt); fm.stop(tt + dur + 0.05);
      tt += dur + (type === 2 ? 0.03 : 0.05 + Math.random() * 0.08);
    }
  }

  update(dt) {
    if (!this.enabled) return;
    if (this.ctx.state !== 'running') return;
    this.budget = Math.min(40, this.budget + dt * 70);
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this._bird();
      const f = this.listener.forestFactor;
      this.birdTimer = (0.8 + Math.random() * 3.5) / (0.5 + f);
    }
    if (this.windGain) {
      const target = 0.04 + (1 - this.listener.forestFactor) * 0.04;
      this.windGain.gain.value += (target - this.windGain.gain.value) * Math.min(1, dt);
    }
  }

  setVolume(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.value = v;
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
