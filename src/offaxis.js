// Off-axis (asymmetric frustum) projection — Three.js wrapper.
// Pure math lives in offaxis-math.js so the Canvas-2D fallback never loads
// Three.js.

import * as THREE from 'three';

const _vr = new THREE.Vector3();
const _vu = new THREE.Vector3();
const _vn = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _rotMat = new THREE.Matrix4();

export function buildOffAxisProjection({ pa, pb, pc, pe, near, far, camera }) {
  _vr.subVectors(pb, pa).normalize();
  _vu.subVectors(pc, pa).normalize();
  _vn.crossVectors(_vr, _vu).normalize();

  _va.subVectors(pa, pe);
  _vb.subVectors(pb, pe);
  _vc.subVectors(pc, pe);

  const d = -_va.dot(_vn);
  if (d < 1e-4) return;

  const nd = near / d;
  const l = _vr.dot(_va) * nd;
  const r = _vr.dot(_vb) * nd;
  const b = _vu.dot(_va) * nd;
  const t = _vu.dot(_vc) * nd;

  const x = (2 * near) / (r - l);
  const y = (2 * near) / (t - b);
  const A = (r + l) / (r - l);
  const B = (t + b) / (t - b);
  const C = -(far + near) / (far - near);
  const D = -(2 * far * near) / (far - near);

  camera.projectionMatrix.set(
    x, 0, A, 0,
    0, y, B, 0,
    0, 0, C, D,
    0, 0, -1, 0,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  _rotMat.makeBasis(_vr, _vu, _vn.clone().negate());
  camera.quaternion.setFromRotationMatrix(_rotMat);
  camera.position.copy(pe);
}
