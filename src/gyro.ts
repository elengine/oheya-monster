// おへやモンスター - ジャイロ（deviceorientation）で実空間に床を固定
// three.js標準(DeviceOrientationControls)と同様の変換: euler(β, γ, -α, 'YXZ') + 画面向きオフセット。
// カメラ姿勢 = 初期姿勢(baseQ) × デバイス回転の相対変化。映像と同期してモンスターが動く。

import * as THREE from 'three';

export type GyroHandle = {
  active: boolean;   // 実際にイベント受信中
  q: THREE.Quaternion;
  live: () => { alpha: number | null; beta: number | null; gamma: number | null };
  stop: () => void;
};

const deg = (v: number | null) => THREE.MathUtils.degToRad(v ?? 0);
const Z = new THREE.Vector3(0, 0, 1);

export async function startGyro(baseQ: THREE.Quaternion): Promise<GyroHandle> {
  const handle: GyroHandle = {
    active: false,
    q: new THREE.Quaternion().copy(baseQ),
    live: () => ({ alpha: null, beta: null, gamma: null }),
    stop() {},
  };

  if (!('DeviceOrientationEvent' in window)) return handle;
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission === 'function') {
    const p = await DOE.requestPermission().catch(() => 'denied');
    if (p !== 'granted') return handle;
  }

  const euler = new THREE.Euler();
  const qAbs = new THREE.Quaternion();
  const orientQ = new THREE.Quaternion(); // 画面向き(縦=0)オフセット
  let firstInv: THREE.Quaternion | null = null;

  const onRot = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // iOS: alpha=Z方位, beta=X前後, gamma=Y左右 → three.js標準: euler(β, γ, -α, 'YXZ')
    euler.set(deg(e.beta), deg(e.gamma), -deg(e.alpha), 'YXZ');
    // 画面の向き（縦向き=0）を補正
    const angle = ((screen as unknown as { orientation?: { angle?: number } })?.orientation?.angle ?? 0) % 360;
    qAbs.setFromEuler(euler);
    orientQ.setFromAxisAngle(Z, -deg(angle));
    qAbs.multiply(orientQ);

    if (!firstInv) firstInv = qAbs.clone().invert();
    const delta = new THREE.Quaternion().multiplyQuaternions(qAbs, firstInv);
    handle.q.copy(baseQ).multiply(delta);
    handle.live = () => ({ alpha: e.alpha, beta: e.beta, gamma: e.gamma });
    handle.active = true;
  };

  window.addEventListener('deviceorientation', onRot);
  handle.stop = () => window.removeEventListener('deviceorientation', onRot);
  return handle;
}
