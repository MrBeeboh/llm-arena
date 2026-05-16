/** Web Audio API sound effects — no external files needed. */

/** @type {AudioContext | null} */
let ctx = null;
/** @type {AudioBufferSourceNode | null} */
let ambientSource = null;
/** @type {GainNode | null} */
let ambientGain = null;
/** @type {OscillatorNode | null} */
let tensionOsc = null;
/** @type {GainNode | null} */
let tensionGain = null;

let audioEnabled = false;

/** Must be called from a user-gesture handler before any sound plays. */
export function enableAudio() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    audioEnabled = true;
  } catch {
    audioEnabled = false;
  }
}

export function isAudioEnabled() { return audioEnabled && !!ctx; }

function getCtx() {
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Brown noise buffer — warm, crowd-like rumble. */
function makeBrownNoise(c, seconds = 8) {
  const sr = c.sampleRate;
  const len = sr * seconds;
  const buf = c.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

/** Start the ambient crowd murmur loop. */
export function startAmbient() {
  const c = getCtx();
  if (!c || ambientSource) return;

  const buf = makeBrownNoise(c, 6);

  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 280;
  filter.Q.value = 0.6;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.08, c.currentTime + 1.5);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start();

  ambientSource = src;
  ambientGain = gain;
}

/** Stop the ambient crowd murmur with a fade. */
export function stopAmbient() {
  const c = getCtx();
  if (!c || !ambientGain || !ambientSource) return;
  const src = ambientSource;
  const gain = ambientGain;
  ambientSource = null;
  ambientGain = null;
  gain.gain.linearRampToValueAtTime(0, c.currentTime + 1.2);
  setTimeout(() => { try { src.stop(); } catch {} }, 1300);
}

/**
 * Update the rising tension tone. Call with ratio 0–1 (tokenCount / maxTokens).
 * Starts the oscillator on first call above 0.4, ramps up as ratio approaches 1.
 */
export function updateTension(ratio) {
  const c = getCtx();
  if (!c) return;

  if (ratio < 0.4) {
    // Below threshold — fade out if playing
    if (tensionGain) {
      tensionGain.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
    }
    return;
  }

  const targetVol = Math.min(0.12, (ratio - 0.4) / 0.6 * 0.12);
  const targetFreq = 180 + ratio * 240; // 180 Hz → 420 Hz

  if (!tensionOsc) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = targetFreq;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();

    tensionOsc = osc;
    tensionGain = gain;
  }

  tensionOsc.frequency.linearRampToValueAtTime(targetFreq, c.currentTime + 0.5);
  tensionGain.gain.linearRampToValueAtTime(targetVol, c.currentTime + 0.3);
}

/** Stop the tension oscillator. */
export function stopTension() {
  const c = getCtx();
  if (!c || !tensionGain || !tensionOsc) return;
  const osc = tensionOsc;
  const gain = tensionGain;
  tensionOsc = null;
  tensionGain = null;
  gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
  setTimeout(() => { try { osc.stop(); } catch {} }, 500);
}

/** Bell-like winner chime — pleasant, resonant. */
export function playWinnerChime() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const freqs = [880, 1108, 1320, 1760];
  for (let i = 0; i < freqs.length; i++) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freqs[i];
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, now + i * 0.08);
    gain.gain.linearRampToValueAtTime(0.18 - i * 0.03, now + i * 0.08 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 2.5);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 2.6);
  }
}

/** Crowd groan — descending, slightly dissonant wobble. */
export function playCrowdGroan() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const base = 260 - i * 30;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.linearRampToValueAtTime(base * 0.65, now + 1.8);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.07, now + i * 0.04);
    gain.gain.linearRampToValueAtTime(0, now + 2);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    osc.start(now + i * 0.04);
    osc.stop(now + 2.1);
  }
}
