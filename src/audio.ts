// おへやモンスター - Web Audio 完全合成サウンド（ゼロ資産・失敗しない）
// 他作品の教訓: ファイル型は静かに失敗する。合成は失敗しない。

const MUTE_KEY = 'oheya:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let bgmTimer: number | null = null;

function ensure(): boolean {
  if (ctx && master) return true;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  muted = localStorage.getItem(MUTE_KEY) === '1';
  master.gain.value = muted ? 0 : 0.9;
  return true;
}

/** ユーザー操作時（タッチ/クリック）に呼んでロック解除 */
export function unlock(): void {
  if (!ensure()) return;
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
}

type ToneOpts = { type?: OscillatorType; vol?: number; delay?: number; end?: number; glideTo?: number };

function tone(freq: number, dur: number, opts: ToneOpts = {}): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.glideTo) osc.frequency.linearRampToValueAtTime(opts.glideTo, t0 + dur);
  const vol = opts.vol ?? 0.4;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + (opts.end ?? 0.05));
}

function noise(dur: number, opts: { delay?: number; vol?: number; freq?: number; q?: number } = {}): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.freq ?? 1200;
  filter.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  const vol = opts.vol ?? 0.3;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

export type SfxName =
  | 'tap' | 'spawn' | 'throw' | 'hit' | 'catch' | 'flee' | 'miss' | 'dex' | 'start' | 'tick';

export function sfx(name: SfxName): void {
  unlock();
  switch (name) {
    case 'tap': tone(520, 0.09, { type: 'sine', vol: 0.25 }); break;
    case 'start': tone(440, 0.12, { type: 'triangle' }); tone(660, 0.14, { delay: 0.09 }); break;
    case 'spawn': tone(392, 0.16, { glideTo: 660, vol: 0.3 }); tone(523, 0.2, { delay: 0.05, vol: 0.2 }); break;
    case 'throw': noise(0.16, { freq: 2400, vol: 0.25 }); break;
    case 'hit': tone(880, 0.1, { type: 'square', vol: 0.3 }); noise(0.08, { freq: 4000, vol: 0.2 }); break;
    // 捕獲=嬉しい成功音: 明るい上昇アルペジオ + キラッ
    case 'catch': tone(523, 0.1, { type: 'triangle' }); tone(659, 0.1, { delay: 0.07 });
      tone(784, 0.16, { delay: 0.14 }); tone(1046, 0.34, { delay: 0.2, glideTo: 1318, vol: 0.34 });
      noise(0.2, { delay: 0.22, freq: 6500, vol: 0.12 }); break;
    // 逃走=低音ブブー: 下がる唸り(失敗感を強調)
    case 'flee': tone(196, 0.16, { type: 'sawtooth', vol: 0.38 });
      tone(147, 0.3, { delay: 0.12, type: 'sawtooth', vol: 0.38, glideTo: 92 }); break;
    case 'miss': tone(330, 0.2, { glideTo: 220, type: 'sawtooth', vol: 0.25 }); break;
    case 'dex': tone(660, 0.1, { type: 'sine' }); tone(880, 0.1, { delay: 0.07, type: 'sine' }); break;
    case 'tick': tone(600, 0.05, { type: 'sine', vol: 0.2 }); break;
  }
}

/** 軽いアンビエントBGM（ループする低域パッド）*/
export function startBGM(): void {
  if (!ensure() || bgmTimer) return;
  const base = [220, 277.18, 329.63, 369.99];
  let i = 0;
  const step = () => {
    tone(base[i % base.length], 1.9, { type: 'sine', vol: 0.07, glideTo: base[(i + 1) % base.length] });
    i++;
  };
  step();
  bgmTimer = window.setInterval(step, 1900);
}

export function stopBGM(): void {
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
}

export function isAudibleReady(): boolean {
  return !!ctx && ctx.state === 'running';
}
