// おへやモンスター - AR/シミュレーション共通ゲームフィールド
// Pokemon GO風: モンスター周囲の判定リングがズームイン・アウト。
// 手前からスワイプでボールを投げ、リングが小さいときに当たると捕獲品質が上がる。

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
  ring: THREE.Mesh;
  ringPhase: number;
  ringBase: number;
  ringR: number;
  species: Species;
  floorY: number;
  state: 'idle' | 'targeted' | 'fleeing';
  age: number;
};

type Ball = { mesh: THREE.Mesh; t: number; from: THREE.Vector3; mid: THREE.Vector3; to: THREE.Vector3 };

const MAX_MONSTERS = 3;
const BASE_RATE: Record<number, number> = { 1: 0.68, 2: 0.55, 3: 0.40 };

export class GameField {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  world = new THREE.Group();
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30);
  currentCamera: THREE.Camera = this.camera;
  private monsters: MonsterRef[] = [];
  private balls: Ball[] = [];
  private cb: FieldCallbacks;
  private downT = 0;
  private downXY: [number, number] = [0, 0];
  private throwing = false;

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

    // GO方式スワイプ: down で開始、up で投げ
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      this.downT = performance.now();
      this.downXY = [e.clientX, e.clientY];
    });
    el.addEventListener('pointerup', (e: PointerEvent) => {
      const dx = e.clientX - this.downXY[0];
      const dy = e.clientY - this.downXY[1];
      this.trySwipe(dx, dy, e.clientX, e.clientY);
    });
  }

  onResize(): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  spawnAt(pos: THREE.Vector3, species: Species): MonsterRef {
    const group = buildMonster(species);
    group.position.copy(pos);

    // 判定リング（床に水平・ズームイン/アウトする丸枠）
    const ringBase = (species.baseScale * 0.9) / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0x3eff6a, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.scale.multiplyScalar(ringBase);
    ring.position.y = pos.y + 0.012;
    group.add(ring);

    const ref: MonsterRef = {
      root: group,
      ring,
      ringPhase: Math.random() * Math.PI * 2,
      ringBase,
      ringR: 0.5,
      species,
      floorY: pos.y,
      state: 'idle',
      age: 0,
    };
    group.userData.monsterRef = ref;
    group.traverse((o) => { o.userData.monsterRef = ref; });
    this.world.add(group);
    this.monsters.push(ref);
    this.cb.setStatus(`${species.name} が あらわれた！`);
    sfx('spawn');
    return ref;
  }

  activeCount(): number { return this.monsters.length; }
  maxCount(): number { return MAX_MONSTERS; }

  /** モンスターの画面座標（QA/ターゲット選択用） */
  projectToScreen(ref: MonsterRef): { x: number; y: number } {
    const v = new THREE.Vector3();
    ref.root.getWorldPosition(v);
    v.y += ref.species.baseScale * 0.8;
    v.project(this.currentCamera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  private trySwipe(dx: number, dy: number, upX: number, upY: number): void {
    if (this.throwing) return;
    const dur = performance.now() - this.downT;
    const isSwipe = dur < 550 && Math.hypot(dx, dy) > 46;
    const isTap = dur < 320 && Math.hypot(dx, dy) < 30;
    if (!isSwipe && !isTap) return;

    // 投げた先に最も近いモンスターを狙う
    let best: MonsterRef | null = null;
    let bestD = isSwipe ? 230 : 120;
    for (const m of this.monsters) {
      if (m.state !== 'idle') continue;
      const p = this.projectToScreen(m);
      const d = Math.hypot(p.x - upX, p.y - upY);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (!best) { this.airThrow(upX); return; }
    this.throwAt(best);
  }

  private airThrow(x: number): void {
    const ball = this.makeBall();
    ball.position.setFromMatrixPosition(this.currentCamera.matrixWorld).add(new THREE.Vector3(0, -0.3, 0));
    this.world.add(ball);
    ball.userData.targetRef = undefined;
    const b: Ball = { mesh: ball, t: 0, from: ball.position.clone(), mid: ball.position.clone().add(new THREE.Vector3(0, 1.2, -1.5)), to: ball.position.clone().add(new THREE.Vector3(x * 0.01, 2.5, -4)) };
    this.balls.push(b);
    sfx('throw');
    this.cb.setStatus('ボールは とどかなかった…');
  }

  private makeBall(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xff4f6e, roughness: 0.3 })
    );
  }

  private throwAt(ref: MonsterRef): void {
    ref.state = 'targeted';
    this.throwing = true;
    const target = new THREE.Vector3();
    ref.root.getWorldPosition(target);
    target.y += ref.species.baseScale * 0.6;

    const from = target.clone().add(new THREE.Vector3(0, -0.15, 1.4));
    const mid = target.clone().add(new THREE.Vector3(0, 1.0, 0.4));
    const ball = this.makeBall();
    ball.userData.targetRef = ref;
    ball.position.copy(from);
    this.world.add(ball);
    this.balls.push({ mesh: ball, t: 0, from: from.clone(), mid, to: target.clone() });

    // ゴーの「投げ」SE
    sfx('throw');
  }

  private updateBall(b: Ball, ref: MonsterRef | null, dt: number): void {
    b.t += dt / 0.4;
    const k = Math.min(b.t, 1);
    const p = new THREE.Vector3().lerpVectors(b.from, b.mid, k);
    const q = new THREE.Vector3().lerpVectors(b.mid, b.to, k);
    b.mesh.position.lerpVectors(p, q, k);
    if (k < 1) return;
    this.world.remove(b.mesh);
    if (ref) this.resolveCatch(ref);
  }

  private resolveCatch(ref: MonsterRef): void {
    const sp = ref.species;
    // リングの大きさに応じた品質（小さいほど返る値 f が小さい → 高性能）
    const f = ref.ringR;
    let mult = 1.0, quality = 'ok';
    if (f <= 0.18) { mult = 1.8; quality = 'excellent'; }
    else if (f <= 0.35) { mult = 1.5; quality = 'great'; }
    else if (f <= 0.55) { mult = 1.25; quality = 'nice'; }

    const rate = Math.min(0.95, (BASE_RATE[sp.tier] ?? 0.6) * mult);
    if (Math.random() < rate) {
      addCatch(sp.id);
      this.cb.onCatch();
      this.cb.setStatus(`${quality}！ ${sp.name} を つかまえた！`);
      sfx('catch');
      this.removeMonster(ref);
    } else {
      ref.state = 'fleeing';
      ref.ring.visible = false;
      this.cb.setStatus(`${sp.name} は リングから とびだした…`);
      sfx('miss');
    }
    this.throwing = false;
  }

  private removeMonster(ref: MonsterRef): void {
    this.world.remove(ref.root);
    this.world.remove(ref.ring);
    this.monsters = this.monsters.filter((m) => m !== ref);
  }

  private updateMonster(ref: MonsterRef, dt: number): void {
    ref.age += dt;
    const phase = (ref.root.userData.bobPhase as number) ?? 0;
    const amp = (ref.root.userData.bobAmp as number) ?? 0.03;
    ref.root.position.y = ref.floorY + Math.sin(ref.age * 3 + phase) * amp;

    // 判定リングのズームイン・アウト
    const s = 0.5 - 0.5 * Math.cos(ref.age * 2.6 + ref.ringPhase);
    ref.ringR = 0.1 + s * 0.75; // 0.10〜0.85
    ref.ring.scale.setScalar(ref.ringBase * (0.25 + s * 1.1));
    // 色: 小→緑 / 中→黄 / 大→赤
    const c = ref.ring.material as THREE.MeshBasicMaterial;
    c.color.setHSL((1 - s) * 0.33, 0.9, 0.55);

    if (ref.state === 'fleeing') {
      ref.root.rotation.y += dt * 6;
      ref.root.position.y += Math.abs(Math.sin(ref.age * 10)) * 0.03;
      ref.root.scale.multiplyScalar(1 - dt * 1.2);
      if (ref.root.scale.x < 0.05) this.removeMonster(ref);
    }
  }

  update(dt: number): void {
    for (const ref of [...this.monsters]) this.updateMonster(ref, dt);
    // ボール進行（targetRef は throwAt/airThrow で設定）
    for (const b of this.balls) {
      this.updateBall(b, (b.mesh.userData.targetRef as MonsterRef | undefined) ?? null, dt);
    }
    this.balls = this.balls.filter((b) => b.mesh.parent === this.world);
  }

  setCamera(cam: THREE.Camera): void {
    this.currentCamera = cam;
  }
}
