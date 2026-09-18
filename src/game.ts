// おへやモンスター - AR/シミュレーション共通ゲームフィールド
// Pokemon GO風: モンスター正面に判定リング（ズームイン/アウト）。
// 画面手前の可愛いボールをそっとスワイプで投げ、リングが小さいときに当たると高品質。

import * as THREE from 'three';
import { type Species, buildMonster, adaptModel } from './models';
import { sfx } from './audio';
import { addCatch } from './dex';

export type FieldCallbacks = {
  setStatus: (msg: string, bad?: boolean) => void;
  onCatch: () => void;
};

type MotionKind = 'breathe' | 'stretch' | 'hop' | 'fly';

type MonsterRef = {
  root: THREE.Group;
  ring: THREE.Mesh;
  ringPhase: number;
  ringBase: number;
  ringR: number;
  species: Species;
  floorY: number;
  floorX: number;
  motion: MotionKind;
  m0: THREE.Vector3;
  state: 'idle' | 'targeted' | 'fleeing';
  age: number;
  fleeAt: number;
};

type Ball = { mesh: THREE.Group; t: number; from: THREE.Vector3; mid: THREE.Vector3; to: THREE.Vector3 };

const MAX_MONSTERS = 5;
const BASE_RATE: Record<number, number> = { 1: 0.68, 2: 0.55, 3: 0.40 };
const HAND_DEPTH = 1.7; // 手前のボールを置く奥行(画面下へ常時投影)

export class GameField {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  world = new THREE.Group();
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30);
  currentCamera: THREE.Camera = this.camera;
  private monsters: MonsterRef[] = [];
  private balls: Ball[] = [];
  private hand: THREE.Group | null;
  private nextHandT = 0;
  private cb: FieldCallbacks;
  private pool: THREE.Object3D[] = [];
  private poolIdx = 0;
  private downXY: [number, number] = [0, 0];
  private upXY: [number, number] = [0, 0];
  private dragging = false;
  private moved = false;
  private dragPoint: THREE.Vector3 | null = null;
  private throwing = false;

  setModelPool(p: THREE.Object3D[]): void { this.pool = p; }

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

    // 画面手前に常時表示される「可愛いボール」（初期は画面下へ投影）
    this.hand = this.makeBall();
    this.hand.position.copy(this.pointFromNdc(0, -0.72, HAND_DEPTH));
    this.scene.add(this.hand);

    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('touchmove', (e: TouchEvent) => e.preventDefault(), { passive: false });
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      this.downXY = [e.clientX, e.clientY];
      this.dragging = true;
      this.moved = false;
    });
    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragging) return;
      if (Math.hypot(e.clientX - this.downXY[0], e.clientY - this.downXY[1]) > 12) this.moved = true;
      this.dragPoint = this.pointAtPlane(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', (e: PointerEvent) => {
      this.dragging = false;
      this.upXY = [e.clientX, e.clientY];
      this.trySwipe();
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
    const group = this.pool.length
      ? adaptModel(this.pool[this.poolIdx++ % this.pool.length], species.baseScale)
      : buildMonster(species);
    group.position.x += pos.x;
    group.position.y += pos.y;
    group.position.z += pos.z;
    // 床影（glTF/プロシージャル共通）
    const sh = new THREE.Mesh(
      new THREE.CircleGeometry(species.baseScale * 0.62, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
    );
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.004;
    group.add(sh);

    // 判定リング: モンスターの正面（縦の丸枠・カメラ方向を向く）
    const ringBase = species.baseScale * 0.55;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0x3eff6a, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.position.set(0, species.baseScale * 0.75, species.baseScale * 0.42); // 正面に立てる
    ring.scale.setScalar(species.baseScale * 0.6);
    group.add(ring);

    const ref: MonsterRef = {
      root: group, ring, ringPhase: Math.random() * Math.PI * 2,
      ringBase, ringR: 0.5, species, floorY: pos.y, floorX: pos.x,
      motion: (['breathe', 'stretch', 'hop', 'fly'] as MotionKind[])[Math.floor(Math.random() * 4)],
      m0: group.scale.clone(), state: 'idle', age: 0, fleeAt: 0,
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
  private maxN = MAX_MONSTERS;
  setMax(n: number): void { this.maxN = Math.max(1, Math.min(10, Math.round(n))); }
  maxCount(): number { return this.maxN; }

  /** モンスターの画面座標（QA/ターゲット選択用） */
  projectToScreen(ref: MonsterRef): { x: number; y: number } {
    const v = new THREE.Vector3();
    ref.root.getWorldPosition(v);
    v.y += ref.species.baseScale * 0.9;
    v.project(this.currentCamera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /** NDC座標 → 手前の平面(奥行depth)上のワールド点 */
  private pointFromNdc(nx: number, ny: number, depth: number): THREE.Vector3 {
    const ndc = new THREE.Vector3(nx, ny, 0.5).unproject(this.currentCamera);
    const dir = ndc.sub(this.currentCamera.position);
    const t = (depth - this.currentCamera.position.z) / dir.z;
    return this.currentCamera.position.clone().add(dir.multiplyScalar(t));
  }

  /** 画面座標を手前の平面(z固定)上のワールド点に変換（ボールを指でつまむ用） */
  private pointAtPlane(clientX: number, clientY: number): THREE.Vector3 {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return this.pointFromNdc((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1, HAND_DEPTH);
  }

  private trySwipe(): void {
    // タップ（移動なし）では飛ばさない / わずかな移動でも速度に関係なく飛ばす
    if (!this.moved) return;
    if (this.throwing && this.hand) return;

    let best: MonsterRef | null = null;
    let bestD = 300;
    for (const m of this.monsters) {
      if (m.state !== 'idle') continue;
      const p = this.projectToScreen(m);
      const d = Math.hypot(p.x - this.upXY[0], p.y - this.upXY[1]);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (!best || !this.hand) { if (this.hand) this.airThrow(); return; }
    this.throwAt(best);
  }

  /** 可愛いボール（ポケモンボール風 + 目） */
  private makeBall(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16), new THREE.MeshStandardMaterial({ color: 0xff7ca8, roughness: 0.35 }));
    g.add(body);
    // 白い帯（赤白ボール風）
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.022, 20), new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.5 }));
    g.add(band);
    // 中央ボタン
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
    btn.position.set(0, 0, 0.062);
    g.add(btn);
    // 目
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x2a1f3d, roughness: 0.4 });
    for (const sx of [-0.024, 0.024]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), eyeM);
      eye.position.set(sx, 0.018, 0.058);
      g.add(eye);
    }
    // ハイライト
    const hi = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hi.position.set(-0.028, 0.024, 0.066);
    g.add(hi);
    return g;
  }

  private airThrow(): void {
    if (this.throwing || !this.hand) return;
    const ball = this.hand; // 手前のボール自体を飛ばす
    ball.userData.targetRef = undefined;
    ball.scale.setScalar(1.25);
    const from = ball.position.clone();
    const to = from.clone().add(new THREE.Vector3(0, 2.6, -4.5));
    this.balls.push({ mesh: ball, t: 0, from, mid: from.clone().add(new THREE.Vector3(0, 1.4, -1.6)), to });
    this.hand = null;
    this.nextHandT = performance.now() + 450;
    sfx('throw');
    this.cb.setStatus('ボールは とどかなかった…');
  }

  private throwAt(ref: MonsterRef): void {
    if (this.throwing || !this.hand) return;
    ref.state = 'targeted';
    this.throwing = true;
    const target = new THREE.Vector3();
    ref.root.getWorldPosition(target);
    target.y += ref.species.baseScale * 0.7;

    // 手前のボール自体を飛ばす（投げたら下は一瞬空き、後から新しいボールが降ってくる）
    const ball = this.hand;
    ball.userData.targetRef = ref;
    const from = ball.position.clone();
    const mid = target.clone().add(new THREE.Vector3(0, 0.9, 0.5));
    this.balls.push({ mesh: ball, t: 0, from, mid, to: target.clone() });
    this.hand = null;
    this.nextHandT = performance.now() + 450;

    // 投げたボールを強調（持ち上げて大きく）
    ball.scale.setScalar(1.25);
    sfx('throw');
  }

  private updateBall(b: Ball, ref: MonsterRef | null, dt: number): void {
    b.t += dt / 0.42;
    const k = Math.min(b.t, 1);
    const p = new THREE.Vector3().lerpVectors(b.from, b.mid, k);
    const q = new THREE.Vector3().lerpVectors(b.mid, b.to, k);
    b.mesh.position.lerpVectors(p, q, k);
    if (k >= 1) {
      this.scene.remove(b.mesh);
      if (ref) this.resolveCatch(ref);
    }
  }

  private resolveCatch(ref: MonsterRef): void {
    const sp = ref.species;
    const f = ref.ringR;
    let mult = 1.0, quality = 'ok';
    if (f <= 0.18) { mult = 1.8; quality = 'EXCELLENT'; }
    else if (f <= 0.35) { mult = 1.5; quality = 'GREAT'; }
    else if (f <= 0.55) { mult = 1.25; quality = 'NICE'; }

    const rate = Math.min(0.95, (BASE_RATE[sp.tier] ?? 0.6) * mult);
    if (Math.random() < rate) {
      addCatch(sp.id);
      this.cb.onCatch();
      this.cb.setStatus(`${quality}！ ${sp.name} を つかまえた！`);
      sfx('catch');
      this.removeMonster(ref);
    } else {
      ref.state = 'fleeing';
      ref.fleeAt = ref.age;
      this.cb.setStatus(`${ref.species.name} は にげてしまった…`, true);
      sfx('flee');
    }
    this.throwing = false;
  }

  private removeMonster(ref: MonsterRef): void {
    this.world.remove(ref.root);
    this.monsters = this.monsters.filter((m) => m !== ref);
  }

  private updateMonster(ref: MonsterRef, dt: number): void {
    ref.age += dt;
    ref.root.position.x = ref.floorX;
    const t = ref.age;
    const ph = ref.ringPhase;
    const m0 = ref.m0;
    let y = ref.floorY;
    let sc = m0.clone();
    switch (ref.motion) {
      case 'breathe':   // サイズがふくらんだり縮んだり
        sc = m0.clone().multiplyScalar(1 + Math.sin(t * 4 + ph) * 0.13); break;
      case 'stretch': { // 縦に伸び縮み(伸びると幅は細る)
        const p = Math.sin(t * 5 + ph);
        sc.set(m0.x * (1 + 0.13 * p), m0.y * (1 - 0.24 * p), m0.z * (1 + 0.13 * p));
        break; }
      case 'hop':      // 左右に飛び跳ねる(上下+横)
        ref.root.position.x = ref.floorX + Math.sin(t * 2.2 + ph) * 0.28;
        y = ref.floorY + Math.abs(Math.sin(t * 6 + ph)) * m0.y * 0.95;
        break;
      case 'fly':      // 飛んでいる(浮いてふわふわ)
        y = ref.floorY + m0.y * 2.4 + Math.sin(t * 3 + ph) * m0.y * 0.3;
        break;
    }
    ref.root.position.y = y;
    ref.root.scale.copy(sc);
    const s = 0.5 - 0.5 * Math.cos(ref.age * 2.6 + ref.ringPhase);
    ref.ringR = 0.1 + s * 0.75;
    ref.ring.scale.setScalar(ref.ringBase * (0.25 + s * 1.1));
    const c = ref.ring.material as THREE.MeshBasicMaterial;
    c.color.setHSL((1 - s) * 0.33, 0.9, 0.55);

    if (ref.state === 'fleeing') {
      // 逃げた = 上方向へふわっと舞い上がって回りながら消える
      ref.root.rotation.y += dt * 12;
      ref.root.rotation.z += dt * 4;
      ref.root.position.y += dt * 2.4;        // 真上に逃げる
      ref.root.position.z -= dt * 0.4;
      ref.root.scale.multiplyScalar(1 - dt * 1.8);
      if (ref.root.scale.x < 0.06) this.removeMonster(ref);
    }
  }

  update(dt: number): void {
    for (const ref of [...this.monsters]) this.updateMonster(ref, dt);

    // 手前のボール: 投げた直後は空 → 少し経ってから新しいボールが降りてくる
    if (!this.hand) {
      if (performance.now() >= this.nextHandT) {
        const h = this.makeBall();
        h.position.copy(this.pointFromNdc(0, -0.72, HAND_DEPTH));
        h.scale.setScalar(0.3);
        this.scene.add(h);
        this.hand = h;
      }
    } else {
      if (this.dragging && this.dragPoint) this.hand.position.lerp(this.dragPoint, 0.5);
      else this.hand.position.lerp(this.pointFromNdc(0, -0.72, HAND_DEPTH), 0.12);
      this.hand.scale.lerp(new THREE.Vector3(1, 1, 1), 0.12);
      this.hand.rotation.y += dt * 2;
    }

    for (const b of this.balls) {
      this.updateBall(b, (b.mesh.userData.targetRef as MonsterRef | undefined) ?? null, dt);
    }
    this.balls = this.balls.filter((b) => b.mesh.parent === this.scene);
  }

  setCamera(cam: THREE.Camera): void {
    this.currentCamera = cam;
  }
}
