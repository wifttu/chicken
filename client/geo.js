// 꼭짓점 색을 입힌 도형들을 하나의 지오메트리로 합친다 (드로우콜 줄이기).
import * as THREE from 'three';

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }

  // geo: 아무 BufferGeometry, color: 0xRRGGBB, m: Matrix4 (선택)
  add(geo, color, m) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.length; i++) {
      this.pos.push(p[i]);
      this.nor.push(n[i]);
    }
    for (let i = 0; i < p.length / 3; i++) this.col.push(c.r, c.g, c.b);
    g.dispose();
    return this;
  }

  get empty() {
    return this.pos.length === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// 위치·회전(오일러, YXZ 아님 XYZ)·크기로 행렬 만들기
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.clone().compose(_p, _q, _s);
}
