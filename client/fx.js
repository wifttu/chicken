// 효과: 소용돌이 연기 구름(뛸 때, 쓰러질 때), 깃털, 칼 휘두름, 범인 화살표, 내 닭 발밑 고리.
import * as THREE from 'three';

function canvasTex(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 만화 연기: 동그라미 여러 개를 합친 구름 + 테두리 + 가운데 소용돌이
function puffTexture() {
  return canvasTex(128, (g, S) => {
    const c = [[64, 70, 30], [38, 74, 21], [90, 74, 21], [50, 46, 22], [80, 48, 21], [64, 92, 20]];
    g.lineWidth = 9;
    g.strokeStyle = '#6c6884';
    for (const [x, y, r] of c) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#fbfaff';
    for (const [x, y, r] of c) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(200,196,220,0.6)';
    g.beginPath();
    g.arc(70, 82, 22, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#6c6884';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 3.2;
      const r = 2 + i * 0.33;
      const x = 64 + Math.cos(a) * r;
      const y = 68 + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    void S;
  });
}

function arrowTexture() {
  return canvasTex(128, (g) => {
    g.fillStyle = '#ff3b4a';
    g.strokeStyle = '#fff';
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(64, 116);
    g.lineTo(18, 56);
    g.lineTo(44, 56);
    g.lineTo(44, 10);
    g.lineTo(84, 10);
    g.lineTo(84, 56);
    g.lineTo(110, 56);
    g.closePath();
    g.stroke();
    g.fill();
  });
}

function slashTexture() {
  return canvasTex(128, (g) => {
    const grd = g.createLinearGradient(0, 0, 128, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.95)');
    grd.addColorStop(1, 'rgba(255,255,255,0.2)');
    g.strokeStyle = grd;
    g.lineCap = 'round';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(64, 110, 80, -2.5, -0.65);
    g.stroke();
  });
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    const puffTex = puffTexture();
    this.puffs = [];
    for (let i = 0; i < 110; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false }));
      s.visible = false;
      s.renderOrder = 5;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.pi = 0;

    // 깃털: 흰 잎사귀 모양 평면
    const fg = new THREE.PlaneGeometry(0.1, 0.24);
    this.feathers = new THREE.InstancedMesh(fg, new THREE.MeshLambertMaterial({ color: 0xf6f4fb, side: THREE.DoubleSide }), 80);
    this.feathers.frustumCulled = false;
    this.feathers.count = 0;
    scene.add(this.feathers);
    this.fd = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);

    // 칼 휘두름
    const slashTex = slashTexture();
    this.slashes = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: slashTex, transparent: true, depthWrite: false }));
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      this.slashes.push({ s, life: 0 });
    }

    // 범인 화살표 (잡힌 동안)
    this.arrow = new THREE.Sprite(new THREE.SpriteMaterial({ map: arrowTexture(), transparent: true, depthTest: false }));
    this.arrow.scale.setScalar(0.7);
    this.arrow.renderOrder = 10;
    this.arrow.visible = false;
    scene.add(this.arrow);

    // 내 닭 / 범인 발밑 고리
    const ringGeo = new THREE.RingGeometry(0.52, 0.64, 32).rotateX(-Math.PI / 2);
    this.meRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff3a8, transparent: true, opacity: 0.75, depthWrite: false }));
    this.meRing.renderOrder = 1;
    this.meRing.visible = false;
    scene.add(this.meRing);
    this.badRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3b4a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.badRing.renderOrder = 1;
    this.badRing.visible = false;
    scene.add(this.badRing);
  }

  puff(x, y, z, size = 1, opts = {}) {
    const p = this.puffs[this.pi++ % this.puffs.length];
    p.life = 0;
    p.max = opts.life ?? 0.7 + Math.random() * 0.3;
    p.vx = opts.vx ?? (Math.random() - 0.5) * 0.4;
    p.vy = opts.vy ?? 0.35 + Math.random() * 0.3;
    p.vz = opts.vz ?? (Math.random() - 0.5) * 0.4;
    p.size = size * (0.85 + Math.random() * 0.3);
    p.s.position.set(x, y, z);
    p.s.material.rotation = Math.random() * Math.PI * 2;
    p.s.material.opacity = 1;
    p.s.visible = true;
    p.s.scale.setScalar(0.01);
  }

  // 쓰러질 때: 연기 고리 + 깃털
  burst(x, z) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.puff(x + Math.sin(a) * 0.4, 0.45 + Math.random() * 0.3, z + Math.cos(a) * 0.4, 1.1, { vx: Math.sin(a) * 1.6, vz: Math.cos(a) * 1.6, vy: 0.6, life: 0.9 + Math.random() * 0.3 });
    }
    for (let i = 0; i < 14; i++) {
      if (this.fd.length >= 80) this.fd.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.2;
      this.fd.push({ x, y: 0.8 + Math.random() * 0.4, z, vx: Math.sin(a) * sp, vy: 2 + Math.random() * 2.5, vz: Math.cos(a) * sp, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6, spin: (Math.random() - 0.5) * 12, life: 0, max: 1.8 + Math.random() * 1.2, seed: Math.random() * 10 });
    }
  }

  slash(x, z, yaw) {
    const s = this.slashes.find((q) => q.life <= 0) || this.slashes[0];
    s.life = 0.22;
    s.s.position.set(x + Math.sin(yaw) * 0.9, 0.85, z + Math.cos(yaw) * 0.9);
    s.s.scale.setScalar(1.3);
    s.s.material.rotation = Math.random() * 0.6 - 0.3;
    s.s.visible = true;
  }

  update(dt, t) {
    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.life += dt;
      const u = p.life / p.max;
      if (u >= 1) {
        p.s.visible = false;
        continue;
      }
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.vx *= 1 - 3 * dt;
      p.vz *= 1 - 3 * dt;
      p.s.scale.setScalar(p.size * (0.35 + 0.75 * (1 - (1 - u) ** 3)));
      p.s.material.opacity = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
      p.s.material.rotation += dt * 0.8;
    }
    let n = 0;
    for (let i = this.fd.length - 1; i >= 0; i--) {
      const f = this.fd[i];
      f.life += dt;
      if (f.life > f.max) {
        this.fd.splice(i, 1);
        continue;
      }
      f.vy -= 6 * dt;
      f.vx *= 1 - 2.2 * dt;
      f.vz *= 1 - 2.2 * dt;
      if (f.vy < -0.7) f.vy = -0.7; // 깃털은 천천히 떨어진다
      f.x += (f.vx + Math.sin(t * 3 + f.seed) * 0.4) * dt;
      f.z += f.vz * dt;
      f.y = Math.max(0.04, f.y + f.vy * dt);
      f.rx += f.spin * dt * (f.y > 0.05 ? 1 : 0);
      f.rz += f.spin * 0.6 * dt * (f.y > 0.05 ? 1 : 0);
    }
    for (const f of this.fd) {
      const k = Math.min(1, (f.max - f.life) / 0.4);
      this._e.set(f.rx, f.ry, f.rz);
      this._q.setFromEuler(this._e);
      this._v.set(f.x, f.y, f.z);
      this._s.setScalar(k);
      this.feathers.setMatrixAt(n++, this._m.compose(this._v, this._q, this._s));
    }
    this.feathers.count = n;
    this.feathers.instanceMatrix.needsUpdate = true;
    for (const s of this.slashes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.s.material.opacity = Math.max(0, s.life / 0.22);
      s.s.scale.setScalar(1.3 + (0.22 - s.life) * 2);
      if (s.life <= 0) s.s.visible = false;
    }
  }
}
