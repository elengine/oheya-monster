// おへやモンスター - モンスター種定義 + three.jsプリミティブ合成の低ポリ生物

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export type Species = {
  id: string;
  name: string;
  color: number;
  accent: number;
  tier: 1 | 2 | 3;          // 1=よく出る, 2=ふつう, 3=レア
  baseScale: number;         // 実サイズの基準（メートル相当）
  /** 体型プロファイル: どのパーツをどう置くか */
  body: 'round' | 'tall' | 'wide';
  hasHorns: boolean;
  hasTail: boolean;
};

export const SPECIES: Species[] = [
  { id: 'pin',   name: 'ピンタ',   color: 0x7cf0ff, accent: 0x2f6bff, tier: 1, baseScale: 0.34, body: 'round', hasHorns: false, hasTail: true  },
  { id: 'mochi', name: 'モチモン', color: 0xffb3d9, accent: 0xff5f9e, tier: 1, baseScale: 0.30, body: 'round', hasHorns: false, hasTail: false },
  { id: 'kusa',  name: 'クリモリ', color: 0x8fe07a, accent: 0x2f9e44, tier: 1, baseScale: 0.36, body: 'tall',  hasHorns: false, hasTail: true  },
  { id: 'honu',  name: 'ゴロホン', color: 0xffca5c, accent: 0xc07a2f, tier: 2, baseScale: 0.42, body: 'wide',  hasHorns: false, hasTail: false },
  { id: 'toge',  name: 'トゲリン', color: 0xc0b0ff, accent: 0x6a4fd0, tier: 2, baseScale: 0.33, body: 'round', hasHorns: true,  hasTail: true  },
  { id: 'kami',  name: 'カミカミ', color: 0xff8a5c, accent: 0xd63a1e, tier: 2, baseScale: 0.38, body: 'tall',  hasHorns: true,  hasTail: true  },
  { id: 'star',  name: 'ホシマル', color: 0xffe97c, accent: 0xffb300, tier: 3, baseScale: 0.30, body: 'round', hasHorns: false, hasTail: false },
  { id: 'rai',   name: 'ライチュウ', color: 0xb3e5ff, accent: 0x1f7bff, tier: 3, baseScale: 0.40, body: 'wide',  hasHorns: true,  hasTail: true  },
];

export function tierRoll(r: () => number): Species {
  const weights = { 1: 55, 2: 32, 3: 13 } as const;
  let pool: Species[] = [];
  for (const s of SPECIES) {
    for (let i = 0; i < weights[s.tier]; i++) pool.push(s);
  }
  return pool[Math.floor(r() * pool.length)];
}

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
}

const footM = mat(0x4a3a30, 0.95);

// CC0 クリーチャー(glTF/GLB) — Gobkit Free Pack / Quaternius系 CC0。models/LICENSE参照
const MODEL_PATHS = ['minion-a01', 'minion-b01', 'minion-c01', 'minion-d01', 'Anglerfish', 'Jellyfish']
  .map((n) => `${import.meta.env.BASE_URL}models/${n}.glb`);

export async function loadMonsterModels(): Promise<THREE.Object3D[]> {
  const loader = new GLTFLoader();
  const out: THREE.Object3D[] = [];
  for (const p of MODEL_PATHS) {
    try {
      const g = await loader.loadAsync(p);
      out.push(g.scene);
    } catch (e) {
      console.warn('[oheya] model load fail', p, e);
    }
  }
  return out;
}

/** モデルを種の実寸にフィット（足元y=0, XZ中心）して複製（rig対応 clone） */
export function adaptModel(base: THREE.Object3D, heightScale: number): THREE.Group {
  const g = SkeletonUtils.clone(base) as THREE.Group;
  const s = sizeScale(base, heightScale);
  g.scale.setScalar(s);
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  g.position.x -= (b.min.x + b.max.x) / 2;
  g.position.z -= (b.min.z + b.max.z) / 2;
  g.position.y -= b.min.y;
  return g;
}

function sizeScale(o: THREE.Object3D, heightScale: number): number {
  const b = new THREE.Box3().setFromObject(o);
  const size = b.getSize(new THREE.Vector3());
  return size.y ? (heightScale / size.y) * 1.5 : heightScale;
}


/**
 * 種に応じてオリジナル低ポリ生物を組み立てる。
 * 床置き基準: 群の足元が y=0。idle アニメ用に userData.bob を持たせる。
 */
export function buildMonster(species: Species): THREE.Group {
  const g = new THREE.Group();
  const S = species.baseScale;
  const bodyColor = mat(species.color);
  const accentMat = mat(species.accent);

  // 影（床アンカー用・常に床に張り付く）
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5 * S * 1.6, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  g.add(shadow);

  const body = new THREE.Mesh(new THREE.SphereGeometry(S, 16, 14), bodyColor);
  const head = new THREE.Mesh(new THREE.SphereGeometry(S * 0.62, 14, 12), bodyColor);
  // （足はモジュール版 footM = 濃色を使用）

  if (species.body === 'tall') {
    body.scale.set(0.85, 1.25, 0.85);
    body.position.y = S * 1.1;
    head.position.y = S * 2.1;
  } else if (species.body === 'wide') {
    body.scale.set(1.3, 0.8, 1.0);
    body.position.y = S * 0.75;
    head.position.y = S * 1.55;
  } else {
    body.position.y = S * 0.9;
    head.position.y = S * 0.35 + S * 1.4;
    head.position.z = S * 0.5;
  }
  g.add(body);
  g.add(head);

  // おなか
  const belly = new THREE.Mesh(new THREE.SphereGeometry(S * 0.5, 12, 10), mat(0xf6ffe8));
  belly.position.copy(body.position);
  belly.position.y -= S * 0.12;
  belly.scale.set(0.9, 0.7, 0.9);
  g.add(belly);

  // 目
  const eyeM = mat(0x161b2a, 0.3);
  const eyeG = new THREE.SphereGeometry(S * 0.12, 10, 8);
  const ex = S * 0.26;
  const ey = head.position.y + S * 0.12;
  const ez = head.position.z + S * 0.52;
  const eL = new THREE.Mesh(eyeG, eyeM); eL.position.set(-ex, ey, ez); g.add(eL);
  const eR = new THREE.Mesh(eyeG, eyeM); eR.position.set(ex, ey, ez); g.add(eR);
  const hl = new THREE.Mesh(new THREE.SphereGeometry(S * 0.045, 6, 6), mat(0xffffff, 0.2));
  hl.position.set(-ex + S * 0.03, ey + S * 0.04, ez + S * 0.1); g.add(hl);
  const hr = hl.clone(); hr.position.x = ex + S * 0.03; g.add(hr);

  // 角 / とげ
  if (species.hasHorns) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(S * 0.14, S * 0.42, 8), accentMat);
    horn.position.set(-ex * 1.1, head.position.y + S * 0.52, head.position.z + S * 0.1);
    horn.rotation.z = -0.5; g.add(horn);
    const horn2 = horn.clone(); horn2.position.x = ex * 1.1; horn2.rotation.z = 0.5; g.add(horn2);
  }

  // 尻尾
  if (species.hasTail) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(S * 0.1, S * 0.9, 8), accentMat);
    tail.position.set(0, body.position.y * 0.6, -body.position.z - S * 0.8);
    tail.rotation.x = 0.9;
    g.add(tail);
  }

  // 足（丸型は2本・広型は4本）
  const footN = species.body === 'wide' ? 4 : 2;
  const footH = S * 0.22;
  for (let i = 0; i < footN; i++) {
    const fx = i % 2 === 0 ? -S * 0.42 : S * 0.42;
    const fz = species.body === 'wide' ? (i < 2 ? S * 0.3 : -S * 0.3) : S * 0.15;
    const f = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.09, S * 0.12, footH, 8), footM);
    f.position.set(fx, footH / 2, fz);
    g.add(f);
  }

  // 揺れアニメ用の基準
  // リッチ演出: エミッシブ発光 + オーラ
  const bodyM = bodyColor as THREE.MeshStandardMaterial;
  bodyM.emissive = new THREE.Color(species.color);
  bodyM.emissiveIntensity = 0.28;
  bodyM.roughness = 0.35;
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(S * 1.5, 16, 12),
    new THREE.MeshBasicMaterial({ color: species.accent, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.position.y = S * 1.1;
  glow.scale.y = 0.85;
  g.add(glow);

  g.userData.bobPhase = Math.random() * Math.PI * 2;
  g.userData.bobAmp = 0.03 + Math.random() * 0.03;

  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}
