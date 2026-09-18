// おへやモンスター - カメラ透過型ARモード（getUserMedia + ジャイロで床を実空間に固定）
// カメラを全画面背景に、仮想の床(グリッド)を合成。ジャイロでカメラ姿勢を追従し、
// パンでモンスターがズレ/近づく。捕獲・リング・図鑑・音はGameField側。

import * as THREE from 'three';
import { GameField } from './game';
import { tierRoll, loadMonsterModels } from './models';
import { sfx } from './audio';
import { startGyro } from './gyro';

export async function startCamAR(
  field: GameField,
  video: HTMLVideoElement,
  onEnd: () => void,
): Promise<() => void> {
  let stream: MediaStream | null = null;
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => { /* 次フレームで再生 */ });
    } catch (e) {
      console.warn('[oheya] カメラ起動失敗（映像なしで実行）:', e);
    }
  } else {
    console.warn('[oheya] camera API なし');
  }

  // 仮想の床（半透明グリッド板）
  const grid = new THREE.GridHelper(8, 16, 0x7cf0ff, 0x4f8bff);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 0.02;
  field.scene.add(grid);

  // 初期カメラ構図 → ジャイロでこの初期姿勢 × デバイス回転
  const cam = field.camera;
  cam.fov = 70;
  cam.position.set(0, 1.35, 2.1);
  cam.lookAt(0, 0.55, 0);
  cam.updateProjectionMatrix();
  const baseQ = cam.quaternion.clone();
  field.setCamera(cam);
  field.onResize();

  const gyro = await startGyro(baseQ);

  field.spawnAt(new THREE.Vector3(-0.6, 0, 0.2), tierRoll(Math.random));
  field.spawnAt(new THREE.Vector3(0.6, 0, 0.0), tierRoll(Math.random));
  field.spawnAt(new THREE.Vector3(0.0, 0, -0.3), tierRoll(Math.random));

  loadMonsterModels().then((m) => { if (m.length) field.setModelPool(m); });

  let cooldown = 3.5;
  let prev = -1;
  field.renderer.setAnimationLoop((now) => {
    const dt = prev < 0 ? 0 : (now - prev) / 1000;
    prev = now;
    cooldown -= dt;
    if (cooldown <= 0 && field.activeCount() < field.maxCount()) {
      const x = (Math.random() - 0.5) * 2.4;
      const z = Math.random() * 0.9 - 0.5;
      field.spawnAt(new THREE.Vector3(x, 0, z), tierRoll(Math.random));
      cooldown = 4 + Math.random() * 4;
    }
    // ジャイロ受信状態を表示
    const gs = document.getElementById('gyro-stat');
    if (gs) {
      gs.textContent = gyro.active ? 'ジャイロ:連動OK' : 'ジャイロ:待機…';
      gs.style.borderColor = gyro.active ? 'rgba(120,240,255,.6)' : 'rgba(255,120,100,.5)';
    }
    if (gyro.active) cam.quaternion.copy(gyro.q);
    field.update(dt);
    field.renderer.render(field.scene, cam);
  });
  sfx('start');

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    field.renderer.setAnimationLoop(null);
    gyro.stop();
    if (stream) for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    onEnd();
  };
}
