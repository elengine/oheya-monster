// おへやモンスター - ジャイロ（deviceorientation）で実空間に床を固定
// カメラ姿勢 = 初期姿勢(baseQ) × デバイス回転の相対変化。カメラを回すことで
// 実世界配置のモンスターがパン/前後に動いて見える（映像と同期）。

import * as THREE from 'three';

export type GyroHandle = { active: boolean; q: THREE.Quaternion; stop: () => void };

export async function startGyro(baseQ: THREE.Quaternion): Promise<GyroHandle> {
  const handle: GyroHandle = { active: false, q: new THREE.Quaternion().copy(baseQ), stop() {} };

  if (!('DeviceOrientationEvent' in window)) return handle;
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission === 'function') {
    const p = await DOE.requestPermission().catch(() => 'denied');
    if (p !== 'granted') return handle;
  }

  const euler = new THREE.Euler();
  const qNow = new THREE.Quaternion();
  let firstInv: THREE.Quaternion | null = null;

  const onRot = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // iOS Safari: alpha=Z(方位) beta=X(前後) gamma=Y(左右)
    euler.set(
      THREE.MathUtils.degToRad(e.beta),
      THREE.MathUtils.degToRad(e.gamma),
      THREE.MathUtils.degToRad(e.alpha),
      'ZXY'
    );
    qNow.setFromEuler(euler);
    if (!firstInv) firstInv = qNow.clone().invert();
    const delta = new THREE.Quaternion().multiplyQuaternions(qNow, firstInv);
    handle.q.copy(baseQ).multiply(delta);
    handle.active = true;
  };

  window.addEventListener('deviceorientation', onRot);
  handle.stop = () => window.removeEventListener('deviceorientation', onRot);
  return handle;
}
