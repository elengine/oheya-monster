// おへやモンスター - 非ARシミュレーションモード（デスクトップ/開発/検証用）
// 仮想の床とテーブルを作り、その上にモンスターを配置してARなしで遊べる。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GameField } from './game';
import { tierRoll, loadMonsterModels } from './models';
import { sfx } from './audio';

export function startSim(field: GameField, onEnd: () => void): () => void {
  loadMonsterModels().then((m) => { if (m.length) field.setModelPool(m); });
  const d = field.renderer.domElement;

  // 部屋の「床」と「テーブル」を模した仮想平面
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2f42, roughness: 0.9 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  field.scene.add(floor);

  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 0.7 }));
  tableTop.position.y = 0.74;
  tableTop.receiveShadow = true;
  field.scene.add(tableTop);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x5a4632 });
  for (const lx of [-0.5, 0.5]) {
    for (const lz of [-0.3, 0.3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.74, 0.08), legMat);
      leg.position.set(lx, 0.37, lz);
      field.scene.add(leg);
    }
  }
  // テーブル上の面が見える薄いガイド
  const guide = new THREE.Mesh(
    new THREE.PlaneGeometry(1.16, 0.76),
    new THREE.MeshBasicMaterial({ color: 0x7cf0ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
  );
  guide.rotation.x = Math.PI / 2;
  guide.position.y = 0.79;
  field.scene.add(guide);

  // カメラ
  field.camera.position.set(1.4, 1.35, 2.4);
  field.camera.lookAt(0.2, 0.4, 0);
  field.setCamera(field.camera);
  field.onResize();

  const controls = new OrbitControls(field.camera, d);
  controls.target.set(0.2, 0.4, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 6;

  // 初期モンスター（床2 + テーブル1）
  field.spawnAt(new THREE.Vector3(-0.9, 0, -0.4), tierRoll(Math.random));
  field.spawnAt(new THREE.Vector3(0.9, 0, -0.8), tierRoll(Math.random));
  field.spawnAt(new THREE.Vector3(0.1, 0.74, 0), tierRoll(Math.random));

  // 自動出現
  let cooldown = 3;
  let prev = -1;
  field.renderer.setAnimationLoop((now) => {
    const dt = prev < 0 ? 0 : (now - prev) / 1000;
    prev = now;
    controls.update();
    cooldown -= dt;
    if (cooldown <= 0) {
      const onFloor = Math.random() < 0.7;
      const y = onFloor ? 0 : 0.74;
      const x = (Math.random() - 0.5) * 4;
      const z = (Math.random() - 0.5) * 3.4;
      if (field.activeCount() < field.maxCount()) {
        field.spawnAt(new THREE.Vector3(x, y, z), tierRoll(Math.random));
        cooldown = 5 + Math.random() * 4;
      }
    }
    field.update(dt);
    field.renderer.render(field.scene, field.camera);
  });
  sfx('start');

  return () => {
    field.renderer.setAnimationLoop(null);
    onEnd();
  };
}
