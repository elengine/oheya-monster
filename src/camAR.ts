// おへやモンスター - カメラ透過型ARモード（WebXR不使用）
// iPadカメラ(getUserMedia)を全画面背景に、仮想の床(グリッド)を合成、
// その上に実寸モンスターが立って動く。捕獲・図鑑・音はGameField側。

import * as THREE from 'three';
import { GameField } from './game';
import { tierRoll } from './models';
import { sfx } from './audio';

export async function startCamAR(
  field: GameField,
  video: HTMLVideoElement,
  onEnd: () => void,
): Promise<() => void> {
  let stream: MediaStream | null = null;
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[oheya] camera API なし: 映像なしで実行');
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => { /* 再生イベントは次フレーム */ });
    } catch (e) {
      console.warn('[oheya] カメラ起動失敗（映像なしで実行）:', e);
    }
  }

  // 仮想の床（半透明グリッド板）をシーンに設置
  const grid = new THREE.GridHelper(8, 16, 0x7cf0ff, 0x4f8bff);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 0.02;
  field.scene.add(grid);

  // 視点カメラ（固定・地面が下部に広がる構図）
  const cam = field.camera;
  cam.fov = 70;
  cam.position.set(0, 1.35, 2.1);
  cam.lookAt(0, 0.55, 0);
  cam.updateProjectionMatrix();
  field.setCamera(cam);
  field.onResize();

  // 初期モンスター + 自動出現
  field.spawnAt(new THREE.Vector3(-0.6, 0, 0.2), tierRoll(Math.random));
  field.spawnAt(new THREE.Vector3(0.6, 0, 0.0), tierRoll(Math.random));
  field.spawnAt(new THREE.Vector3(0.0, 0, -0.3), tierRoll(Math.random));

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
    field.update(dt);
    field.renderer.render(field.scene, cam);
  });
  sfx('start');

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    field.renderer.setAnimationLoop(null);
    if (stream) for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    onEnd();
  };
}
