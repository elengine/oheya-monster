// おへやモンスター - AR/シミュレーション共通のゲームフィールド
// 描画・モンスター配置・タップ捕獲(投げ)・捕獲判定・IDLEアニメを一元管理する。

import * as THREE from 'three';
import { type Species, buildMonster } from './models';
import { sfx } from './audio';
import { addCatch } from './dex';

export type FieldCallbacks = {
  setStatus: (msg: string) => void;
  onCatch: () => void;
};

type MonsterRef = {
  root: THREE.Group;
  species: Species;
  state: 'idle' | 'targeted' | 'fleeing';
  age: number;
  fleeV: number;
  ball?: THREE.Mesh;
  ballT: number;
  ballFrom: THREE.Vector3;
  ballMid: THREE.Vector3;
  floorY: number;
};
type AnyMonsterRef = MonsterRef;

const MAX_MONSTERS = 3;
const CATCH_RATE: Record<number, number> = { 1: 0.68, 2: 0.55, 3: 0.40 };

export class GameField {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  world = new THREE.Group();       // モンスターを載せる実世界アンカー群
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30);
  currentCamera: THREE.Camera = this.camera;
  reticle: THREE.Group | null = null;
  private monsters: MonsterRef[] = [];
  private raycaster = new THREE.Raycaster();
  private cb: FieldCallbacks;
  private downAt = 0;
  private downXY: [number, number] = [0, 0];
  private throwAnimating = false;

  constructor(container: HTMLElement, cb: FieldCallbacks) {
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);

    this.scene.add(this.world);

    // タップ捕獲（AR/シミュ両対応）
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      this.downAt = performance.now();
      this.downXY = [e.clientX, e.clientY];
    });
    el.addEventListener('pointerup', (e: PointerEvent) => {
      const dx = e.clientX - this.downXY[0];
      const dy = e.clientY - this.downXY[1];
      const quick = performance.now() - this.downAt < 350;
      const smallMove = Math.hypot(dx, dy) < 28;
      if (!(quick && smallMove)) return;
      const nx = (e.clientX / el.clientWidth) * 2 - 1;
      const ny = -(e.clientY / el.clientHeight) * 2 + 1;
      this.tryCatch(nx, ny);
    });
  }

  onResize(): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  makeReticle(): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.025, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x7cf0ff, transparent: true, opacity: 0.9 })
    );
    ring.rotation.x = Math.PI / 2;
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
    );
    dot.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    g.add(ring, dot);
    g.visible = false;
    this.scene.add(g);
    this.reticle = g;
  }

  setReticle(pos: THREE.Vector3 | null): void {
    if (!this.reticle) return;
    if (!pos) { this.reticle.visible = false; return; }
    this.reticle.position.copy(pos);
    this.reticle.visible = true;
  }

  /** 検出面にモンスターを1体出現させる（種は呼び出し側で選ぶ） */
  spawnAt(pos: THREE.Vector3, species: Species): MonsterRef {
    const group = buildMonster(species);
    group.position.copy(pos);
    const ref: MonsterRef = {
      root: group, species, state: 'idle', age: 0, fleeV: 0,
      ballT: 0, ballFrom: new THREE.Vector3(), ballMid: new THREE.Vector3(), floorY: pos.y,
    };
    group.userData.monsterRef = ref;
    // 全子メッシュにも ref を載せて多段ヒットで拾えるようにする
    group.traverse((o) => { o.userData.monsterRef = ref; });
    this.world.add(group);
    this.monsters.push(ref);
    this.cb.setStatus(`${species.name} が あらわれた！`);
    sfx('spawn');
    return ref;
  }

  activeCount(): number {
    return this.monsters.length;
  }

  maxCount(): number {
    return MAX_MONSTERS;
  }

  private tryCatch(nx: number, ny: number): void {
    if (this.throwAnimating) return;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.currentCamera);
    const targets = this.monsters.map((m) => m.root);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return;
    const ref = hits[0].object.userData?.monsterRef as MonsterRef | undefined;
    if (!ref || ref.state !== 'idle') return;
    this.throwAt(ref);
  }

  private throwAt(ref: MonsterRef): void {
    ref.state = 'targeted';
    this.throwAnimating = true;
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xff4f6e, roughness: 0.3 })
    );
    const target = ref.root.position.clone();
    const camPos = this.currentCamera.position;
    ball.position.copy(target).sub(camPos).normalize().multiplyScalar(1.1).add(target);
    ball.position.y = Math.max(ball.position.y, 0.3);
    this.world.add(ball);
    ref.ball = ball;
    ref.ballT = 0;
    ref.ballFrom.copy(ball.position);
    ref.ballMid.copy(target).add(new THREE.Vector3(0, 0.6, 0));
    sfx('throw');
  }

  private resolveCatch(ref: MonsterRef): void {
    const sp = ref.species;
    if (Math.random() < (CATCH_RATE[sp.tier] ?? 0.6)) {
      addCatch(sp.id);
      this.cb.onCatch();
      this.cb.setStatus(`${sp.name} を つかまえた！`);
      sfx('catch');
      this.removeMonster(ref);
    } else {
      ref.state = 'fleeing';
      this.cb.setStatus(`${sp.name} は にげちゃった…`);
      sfx('miss');
      if (ref.ball) { this.world.remove(ref.ball); ref.ball = undefined; }
    }
    this.throwAnimating = false;
  }

  private removeMonster(ref: AnyMonsterRef): void {
    if (ref.ball) this.world.remove(ref.ball);
    this.world.remove(ref.root);
    this.monsters = this.monsters.filter((m) => m !== ref);
  }

  private updateMonster(ref: MonsterRef, dt: number): void {
    ref.age += dt;
    const phase = (ref.root.userData.bobPhase as number) ?? 0;
    const amp = (ref.root.userData.bobAmp as number) ?? 0.03;
    ref.root.position.y = ref.floorY + Math.sin(ref.age * 3 + phase) * amp;

    if (ref.state === 'targeted' && ref.ball) {
      ref.ballT += dt / 0.35;
      const k = Math.min(ref.ballT, 1);
      const a = ref.ballFrom;
      const b = ref.ballMid;
      const c = ref.root.position.clone().add(new THREE.Vector3(0, 0.15, 0));
      const p = new THREE.Vector3().lerpVectors(a, b, k);
      const q = new THREE.Vector3().lerpVectors(b, c, k);
      ref.ball.position.lerpVectors(p, q, k);
      if (k >= 1) {
        sfx('hit');
        this.resolveCatch(ref);
      }
    } else if (ref.state === 'fleeing') {
      ref.fleeV += dt * 1.5;
      ref.root.position.y += Math.abs(Math.sin(ref.fleeV * 6)) * 0.02;
      ref.root.scale.multiplyScalar(1 - dt * 1.4);
      if (ref.root.scale.x < 0.05) this.removeMonster(ref);
    }
  }

  update(dt: number): void {
    for (const ref of [...this.monsters]) this.updateMonster(ref, dt);
  }

  setCamera(cam: THREE.Camera): void {
    this.currentCamera = cam;
  }
}
