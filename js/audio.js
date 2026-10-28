// Lyd til pause-uret: 3 korte bip + ét langt, valgfri stemme. Afspilles som <audio>, der også høres på lydløs (iPhone).
import { icon } from './icons.js';
const $ = (sel) => document.querySelector(sel);

// Pausens slutsignal: 3 korte bip + ét langt. Afspilles som et <audio>-element, der også høres, når iPhonen er på lydløs,
// og audioSession 'ambient' sørger for, at musik aldrig stoppes. Web Audio er reserve.
const CUES = {
  end: [{ f: 880, dur: 0.14, gap: 0.12 }, { f: 880, dur: 0.14, gap: 0.12 }, { f: 880, dur: 0.14, gap: 0.16 }, { f: 1175, dur: 0.85 }],
  warn: [{ f: 660, dur: 0.2 }],
  silent: [{ f: 0, dur: 0.05 }],
};
const cueUrls = {};
let audioCtx = null, audioReady = false;
const cueAudio = new Audio();
cueAudio.preload = 'auto';
function makeWav(tones, rate = 22050) {
  const total = tones.reduce((sum, t) => sum + t.dur + (t.gap || 0), 0);
  const n = Math.ceil(total * rate), pcm = new Int16Array(n);
  let pos = 0;
  for (const t of tones) {
    const len = Math.floor(t.dur * rate);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (0.012 * rate), (len - i) / (0.03 * rate));
      pcm[pos + i] = Math.sin((2 * Math.PI * t.f * i) / rate) * 0.55 * 32767 * env;
    }
    pos += len + Math.floor((t.gap || 0) * rate);
  }
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const cueUrl = (kind) => (cueUrls[kind] ||= makeWav(CUES[kind]));
const cueMs = (kind) => CUES[kind].reduce((sum, t) => sum + (t.dur + (t.gap || 0)) * 1000, 0);
// 'ambient' blander med anden lyd (musik stopper ikke) og følger lydløs-knappen. Der skiftes aldrig til en type, der overtager lyden.
function setAudioSession() { try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* understøttes ikke */ } }
setAudioSession();
export const REST_MIX_KEY = 'tp.restMix';
export const restMix = () => { try { return localStorage.getItem(REST_MIX_KEY) === 'off' ? 'off' : 'mix'; } catch { return 'mix'; } };
export const setRestMix = (v) => { try { localStorage.setItem(REST_MIX_KEY, v === 'off' ? 'off' : 'mix'); } catch { /* privat tilstand */ } };
// Skal kaldes fra et tryk (✓): iOS lader først derefter appen spille lyd fra et ur
export function unlockAudio() {
  if (audioReady) return;
  try {
    setAudioSession();
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    cueAudio.src = cueUrl('silent');
    const p = cueAudio.play();
    if (p) p.then(() => { cueAudio.pause(); audioReady = true; setAudioSession(); }).catch(() => setAudioSession());
    if (soundMode() === 'speech' && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
  } catch { /* ingen lyd */ }
}
export const SOUND_KEY = 'tp.restSound';
export const SOUND_MODES = ['beep', 'speech', 'off'];
export const soundMode = () => { try { const m = localStorage.getItem(SOUND_KEY); return SOUND_MODES.includes(m) ? m : 'beep'; } catch { return 'beep'; } };
function beepFallback(kind) {
  if (!audioCtx) return;
  let t0 = audioCtx.currentTime;
  for (const t of CUES[kind]) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = t.f; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t.dur);
    o.start(t0); o.stop(t0 + t.dur + 0.05);
    t0 += t.dur + (t.gap || 0);
  }
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'da-DK'; u.rate = 1;
    const voice = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('da'));
    if (voice) u.voice = voice;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* ingen tale */ }
}
export function playCue(kind) {
  ((window.__tp ||= { cues: [] }).cues).push({ kind, at: Date.now() }); // bruges kun til test
  const mode = soundMode();
  if (mode === 'off' || restMix() === 'off') return;
  setAudioSession();
  cueAudio.src = cueUrl(kind); cueAudio.currentTime = 0;
  const p = cueAudio.play();
  if (p) p.catch(() => beepFallback(kind));
  const speech = kind === 'end' && mode === 'speech';
  if (speech) setTimeout(() => speak('Næste sæt'), cueMs('end') + 150);
  setTimeout(() => setAudioSession(), cueMs(kind) + (speech ? 2200 : 400));
}
export function updateSoundButton() {
  const m = soundMode();
  $('#rdSound').innerHTML = icon(m === 'off' ? 'bell-off' : m === 'speech' ? 'speak' : 'bell');
  $('#rdSound').setAttribute('aria-label', { beep: 'Lyd: bip', speech: 'Lyd: bip og stemme', off: 'Lyd: slukket' }[m]);
}

// Skift til næste lydtilstand (bip → bip og stemme → slukket) og gem valget
export function cycleSound() {
  const next = SOUND_MODES[(SOUND_MODES.indexOf(soundMode()) + 1) % SOUND_MODES.length];
  try { localStorage.setItem(SOUND_KEY, next); } catch { /* privat tilstand */ }
  updateSoundButton(); unlockAudio();
  if (next !== 'off') playCue('warn'); // prøvelyd
  return next;
}
