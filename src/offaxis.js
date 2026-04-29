// Off-axis (asymmetric frustum) projection — Robert Kooima, 2009
// Overwrites camera.projectionMatrix and orientation each frame.
// NEVER call camera.updateProjectionMatrix() after this; it would reset the matrix.

import * as THREE from 'three';

const _vr = new THREE.Vector3();
const _vu = new THREE.Vector3();
const _vn = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _rotMat = new THREE.Matrix4();

/**
 * Rebuilds the camera's projection matrix and orientation for off-axis rendering.
 *
 * @param {Object} opts
 * @param {THREE.Vector3} opts.pa  Screen bottom-left corner in world space
 * @param {THREE.Vector3} opts.pb  Screen bottom-right corner in world space
 * @param {THREE.Vector3} opts.pc  Screen top-left corner in world space
 * @param {THREE.Vector3} opts.pe  Eye position in world space
 * @param {number}        opts.near
 * @param {number}        opts.far
 * @param {THREE.Camera}  opts.camera
 */
export function buildOffAxisProjection({ pa, pb, pc, pe, near, far, camera }) {
  // Screen basis vectors
  _vr.subVectors(pb, pa).normalize(); // right
  _vu.subVectors(pc, pa).normalize(); // up
  _vn.crossVectors(_vr, _vu).normalize(); // normal pointing toward viewer

  // Vectors from eye to each screen corner
  _va.subVectors(pa, pe);
  _vb.subVectors(pb, pe);
  _vc.subVectors(pc, pe);

  // Perpendicular distance from eye to screen plane (must be positive)
  const d = -_va.dot(_vn);
  if (d < 1e-4) return; // eye is on or behind screen — skip frame

  // Frustum extents at near plane, scaled by near/d
  const nd = near / d;
  const l = _vr.dot(_va) * nd;
  const r = _vr.dot(_vb) * nd;
  const b = _vu.dot(_va) * nd;
  const t = _vu.dot(_vc) * nd;

  // Build glFrustum projection matrix (column-major, THREE.Matrix4.set() takes row-major args)
  const x = (2 * near) / (r - l);
  const y = (2 * near) / (t - b);
  const A = (r + l) / (r - l);
  const B = (t + b) / (t - b);
  const C = -(far + near) / (far - near);
  const D = -(2 * far * near) / (far - near);

  camera.projectionMatrix.set(
    x, 0,  A,  0,
    0, y,  B,  0,
    0, 0,  C,  D,
    0, 0, -1,  0
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  // Orient camera so it looks through the screen normal.
  // Three.js cameras look down local -Z, so negate vn.
  _rotMat.makeBasis(_vr, _vu, _vn.clone().negate());
  camera.quaternion.setFromRotationMatrix(_rotMat);
  camera.position.copy(pe);
}
