// おへやモンスター - エントリ: UI配線・モード起動・図鑑

import { GameField } from './game';
import * as THREE from 'three';
import { startCamAR } from './camAR';
import { SPECIES } from './models';
import { unlock, sfx, isMuted, setMuted, startBGM, stopBGM } from './audio';
import { setHorizonOffset } from './gyro';
import { loadDex, totalCount } from './dex';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const title = $('title');
const hud = $('hud');
const dex = $('dex');
const verEl = $('ver');
const statusTip = $('status-tip');
const catchCounter = $('catch-counter');
const soundBtn = $<HTMLButtonElement>('sound-btn');
const dexList = $('dex-list');
const app = $('app');
const camVideo = $<HTMLVideoElement>('cam');

let field: GameField | null = null;
let cancelCam: (() => void) | null = null;
let statusTimer: number | null = null;

function showStatus(msg: string, bad = false): void {
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  if (!msg) { statusTip.classList.remove('show', 'bad'); statusTip.textContent = ''; return; }
  statusTip.textContent = msg;
  statusTip.classList.toggle('bad', bad);
  statusTip.classList.remove('show');
  void statusTip.offsetWidth; // rAF/reflowで再アニメーション
  statusTip.classList.add('show');
  statusTimer = window.setTimeout(() => { statusTip.classList.remove('show'); }, 2800);
}

function refreshCount(): void {
  catchCounter.textContent = `つかまえた: ${totalCount()}`;
}

function refreshSoundBtn(): void {
  soundBtn.textContent = isMuted() ? '🔇' : '♪';
}

function makeField(): GameField {
  if (field) return field;
  const f = new GameField(app, {
    setStatus: (msg, bad) => showStatus(msg, bad),
    onCatch: () => refreshCount(),
  });
  field = f;
  // QA用デバッグフック（CDP検証でモンスター座標投影/直接操作に使用）
  (window as unknown as { __oheya?: { field: GameField; project: (i: number) => { x: number; y: number } | null } }).__oheya = {
    field: f,
    project: (i: number) => {
      const g = f.world.children[i];
      if (!g) return null;
      const v = new THREE.Vector3();
      g.getWorldPosition(v);
      v.project(f.camera);
      const w = f.renderer.domElement.clientWidth;
      const h = f.renderer.domElement.clientHeight;
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
    },
  };
  const onResize = () => field?.onResize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  return field;
}

function showTitle(): void {
  stopBGM();
  title.classList.remove('hidden');
  hud.classList.add('hidden');
  dex.classList.add('hidden');
}

async function onStartCam(): Promise<void> {
  unlock();
  sfx('tap');
  const f = makeField();
  showError('');
  try {
    title.classList.add('hidden');
    hud.classList.remove('hidden');
    startBGM();
    cancelCam = await startCamAR(f, camVideo, () => showTitle());
  } catch (e) {
    showTitle();
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[oheya] cam start error:', e);
    showError(`カメラを起動できませんでした（カメラ許可を確認して再試行）\n${msg}`);
  }
}

function showError(msg: string): void {
  const el = $('ar-error');
  if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function exitGame(): void {
  sfx('tap');
  if (cancelCam) { cancelCam(); cancelCam = null; }
  showTitle();
  refreshCount();
}

function renderDex(): void {
  const dexData = loadDex();
  const rows = SPECIES
    .slice()
    .sort((a, b) => (dexData[b.id] ?? 0) - (dexData[a.id] ?? 0))
    .map((s) => {
      const n = dexData[s.id] ?? 0;
      const caught = n > 0;
      return `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 16px;border-bottom:1px solid rgba(124,240,255,.15);background:${caught ? 'rgba(79,139,255,.15)' : 'rgba(0,0,0,.25)'}">
        <span style="display:flex;align-items:center;gap:10px">
          <span style="width:14px;height:14px;border-radius:50%;background:#${s.color.toString(16).padStart(6, '0')};box-shadow:0 0 8px #${s.color.toString(16).padStart(6, '0')}"></span>
          <b>${caught ? s.name : '？？？'}</b> <span style="opacity:.6">${'★'.repeat(s.tier)}</span>
        </span>
        <span style="opacity:${caught ? 1 : .4}">${caught ? `${n} 匹` : 'みつからない'}</span>
      </div>`;
    })
    .join('');
  const total = totalCount();
  dexList.innerHTML =
    `<div style="opacity:.8;padding:8px 16px">これまでにつかまえた: ${total} 匹 / しゅるい ${SPECIES.filter((s) => (loadDex()[s.id] ?? 0) > 0).length} しゅるい</div>` + rows;
}

function wire(): void {
  verEl.textContent = `ver ${__APP_VERSION__}`;
  refreshCount();
  refreshSoundBtn();

  $<HTMLButtonElement>('start-ar').addEventListener('click', () => { void onStartCam(); });
  $<HTMLButtonElement>('exit-btn').addEventListener('click', exitGame);
  const settings = $<HTMLDivElement>('settings');
  const horizon = $<HTMLInputElement>('horizon');
  const horizonVal = $('horizon-val');
  const saved = localStorage.getItem('oheya:horizon');
  if (saved != null) { const v = parseInt(saved, 10) || 0; setHorizonOffset(v); horizon.value = String(v); horizonVal.textContent = v + '°'; }
  $<HTMLButtonElement>('settings-btn').addEventListener('click', () => { unlock(); sfx('tap'); settings.classList.remove('hidden'); });
  horizon.addEventListener('input', () => { const v = parseInt(horizon.value, 10) || 0; setHorizonOffset(v); horizonVal.textContent = v + '°'; localStorage.setItem('oheya:horizon', String(v)); });
  $<HTMLButtonElement>('settings-done').addEventListener('click', () => { sfx('tap'); settings.classList.add('hidden'); });
  soundBtn.addEventListener('click', () => { setMuted(!isMuted()); refreshSoundBtn(); sfx('tap'); });
  $<HTMLButtonElement>('dex-btn').addEventListener('click', () => { sfx('dex'); renderDex(); dex.classList.remove('hidden'); });
  $<HTMLButtonElement>('dex-close').addEventListener('click', () => { sfx('tap'); dex.classList.add('hidden'); });
}

wire();
