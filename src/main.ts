// おへやモンスター - エントリ: UI配線・モード起動・図鑑

import { GameField } from './game';
import * as THREE from 'three';
import { startAR, arSupported } from './ar';
import { startSim } from './sim';
import { SPECIES } from './models';
import { unlock, sfx, isMuted, setMuted, startBGM, stopBGM } from './audio';
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

let field: GameField | null = null;
let cancelAR: (() => void) | null = null;
let cancelSim: (() => void) | null = null;
let arSessionEnd: (() => void) | null = null;

function refreshCount(): void {
  catchCounter.textContent = `つかまえた: ${totalCount()}`;
}

function refreshSoundBtn(): void {
  soundBtn.textContent = isMuted() ? '🔇' : '♪';
}

function makeField(): GameField {
  if (field) return field;
  const f = new GameField(app, {
    setStatus: (msg) => { statusTip.textContent = msg; },
    onCatch: () => refreshCount(),
  });
  field = f;
  field.makeReticle();
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

async function onStartAR(): Promise<void> {
  unlock();
  sfx('tap');
  const f = makeField();
  if (!(await arSupported())) {
    statusTip.textContent = 'この端末ではARが使えません。デモ（PC用）でお試しください';
    return;
  }
  title.classList.add('hidden');
  hud.classList.remove('hidden');
  startBGM();
  const handle = await startAR(f, () => { showTitle(); });
  if (handle) { arSessionEnd = handle.end; }
  else { showTitle(); }
}

function onStartSim(): void {
  unlock();
  sfx('tap');
  const f = makeField();
  title.classList.add('hidden');
  hud.classList.remove('hidden');
  startBGM();
  cancelSim = startSim(f, () => showTitle());
}

function exitGame(): void {
  sfx('tap');
  if (cancelSim) { cancelSim(); cancelSim = null; }
  if (cancelAR) { cancelAR(); cancelAR = null; }
  if (arSessionEnd) { void arSessionEnd(); arSessionEnd = null; }
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

  $<HTMLButtonElement>('start-ar').addEventListener('click', () => { void onStartAR(); });
  $<HTMLButtonElement>('start-sim').addEventListener('click', onStartSim);
  $<HTMLButtonElement>('exit-btn').addEventListener('click', exitGame);
  soundBtn.addEventListener('click', () => { setMuted(!isMuted()); refreshSoundBtn(); sfx('tap'); });
  $<HTMLButtonElement>('dex-btn').addEventListener('click', () => { sfx('dex'); renderDex(); dex.classList.remove('hidden'); });
  $<HTMLButtonElement>('dex-close').addEventListener('click', () => { sfx('tap'); dex.classList.add('hidden'); });
}

wire();
