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

// iOS/iPadOS: モーション許可ポップアップは「タップ直後」に呼ぶと安定して出る。
// iOS13+は設定トグル廃止のため、この requestPermission が正規ルート。
export async function requestGyroPermission(): Promise<boolean> {
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission === 'function') {
    const p = await DOE.requestPermission().catch(() => 'denied');
    return p === 'granted';
  }
  return true;
}

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
  const z90Q = new THREE.Quaternion().setFromAxisAngle(Z, -Math.PI / 2); // 端末→3D座標変換
  const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // three.js標準の結合成分

  // FPS視点: カメラ姿勢 = 端末の向き(絶対)。左右は視点が回り世界は回らず、仰ぎで地平線が動く
  const onRot = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const angle = ((screen as unknown as { orientation?: { angle?: number } })?.orientation?.angle ?? 0) % 360;
    euler.set(deg(e.beta), deg(e.gamma), -deg(e.alpha), 'YXZ');
    qAbs.setFromEuler(euler);
    const qz = new THREE.Quaternion().setFromAxisAngle(Z, -deg(angle));
    qAbs.multiply(qz);
    qAbs.multiply(z90Q).multiply(q1);
    handle.q.copy(baseQ).multiply(qAbs);
    // ロール(首を傾ける軸)=0 にし、ヨー(左右)＋ピッチ(仰ぎ)のみのFPS視点に →
    // 地平線を水平に保ち、モンスター/ボールが横倒しで視界から消えない
    const _e = new THREE.Euler().setFromQuaternion(handle.q, 'YXZ');
    // ピッチ(仰ぎ)を反転: 端末を奥に倒すと3D床の奥側がせり上がり実空間の平面と一致する
    handle.q.setFromEuler(new THREE.Euler(-_e.x, _e.y + Math.PI, 0, 'YXZ'));
    handle.live = () => ({ alpha: e.alpha, beta: e.beta, gamma: e.gamma });
    handle.active = true;
  };

  window.addEventListener('deviceorientation', onRot);
  handle.stop = () => window.removeEventListener('deviceorientation', onRot);
  return handle;
}
