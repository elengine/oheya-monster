// おへやモンスター - WebXR AR セッション（iPad Safari 18 / ARKit 委譲）
// 平面検出(hit-test) → レティクル → モンスター自動出現。タップ捕獲はGameField側。

import * as THREE from 'three';
import { GameField } from './game';
import { tierRoll } from './models';
import { sfx } from './audio';

export async function arSupported(): Promise<boolean> {
  const xr = navigator.xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

export type ArHandle = { session: XRSession; end: () => Promise<void> };

export async function startAR(field: GameField, onEnd: () => void): Promise<ArHandle | null> {
  const xr = navigator.xr;
  if (!xr) return null;

  const hud = document.getElementById('hud')!;
  const session = await xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['plane-detection', 'dom-overlay'],
    domOverlay: { root: hud },
  });

  field.renderer.xr.enabled = true;
  field.renderer.xr.setReferenceSpaceType('local-floor');
  await field.renderer.xr.setSession(session);

  const refSpace = field.renderer.xr.getReferenceSpace()!;
  const viewer = await session.requestReferenceSpace('viewer');

  let hitSource: XRHitTestSource | null = null;
  if (viewer && session.requestHitTestSource) {
    try {
      const src = await session.requestHitTestSource({
        space: viewer,
        entityTypes: ['plane', 'point'] as unknown as XRHitTestTrackableType[],
      });
      hitSource = src ?? null;
    } catch { /* hit-test 未対応でもプレイ継続 */ }
  }

  let prev = -1;
  let cooldown = 0;
  const spawnInterval = 4.5;

  field.renderer.setAnimationLoop((now, frame) => {
    if (!frame) return;
    const dt = prev < 0 ? 0 : (now - prev) / 1000;
    prev = now;

    // レンダリング用カメラ（XR）を捕獲判定に使用
    const xrCam = field.renderer.xr.getCamera();
    field.setCamera(xrCam);

    // 実平面ヒットテスト
    let pos: THREE.Vector3 | null = null;
    if (hitSource) {
      try {
        const hits = frame.getHitTestResults(hitSource);
        if (hits.length) {
          const pose = hits[0].getPose(refSpace);
          if (pose) {
            const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
            pos = new THREE.Vector3().setFromMatrixPosition(m);
          }
        }
      } catch { /* ignore */ }
    }
    field.setReticle(pos);

    // 面にモンスターを自動出現
    if (pos) {
      cooldown -= dt;
      if (cooldown <= 0 && field.activeCount() < field.maxCount()) {
        field.spawnAt(pos, tierRoll(Math.random));
        cooldown = spawnInterval;
      }
    }

    field.update(dt);
    field.renderer.render(field.scene, xrCam);
  });

  const end = async () => {
    try { await session.end(); } catch { /* ignore */ }
  };
  session.addEventListener('end', () => {
    field.renderer.setAnimationLoop(null);
    onEnd();
  });
  sfx('start');
  return { session, end };
}
