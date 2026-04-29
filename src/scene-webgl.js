// Three.js scene for the WebGL path. Builds an RGB-vertex-colored wireframe
// cube and a five-wall wireframe-grid room, then drives an off-axis camera.

import * as THREE from 'three';
import { buildOffAxisProjection } from './offaxis.js';

const ROOM_W = 2.4;
const ROOM_H = 1.6;
const ROOM_D = 1.6;

const WALL_COLOR = 0x2bd8ff;
const WALL_OPACITY = 0.45;

export function createWebGLScene(canvas) {
  const isMobile = window.innerWidth < 768;
  const divs = isMobile ? 12 : 20;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x05060b, 1);

  const scene = new THREE.Scene();

  const room = buildRoom(divs);
  scene.add(room);

  const cube = buildRgbCube(0.42);
  // Park the cube near the back of the room for a strong parallax effect.
  cube.position.set(0, 0, -ROOM_D * 0.55);
  scene.add(cube);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.matrixAutoUpdate = false;

  // Virtual screen corners — refreshed on resize so the projection always
  // matches the actual viewport aspect.
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const pc = new THREE.Vector3();
  function updateScreenRect() {
    const aspect = window.innerWidth / window.innerHeight;
    const maxW = ROOM_W * 0.95;
    const maxH = ROOM_H * 0.95;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    pa.set(-w / 2, -h / 2, 0);
    pb.set( w / 2, -h / 2, 0);
    pc.set(-w / 2,  h / 2, 0);
  }
  updateScreenRect();

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    updateScreenRect();
  }
  window.addEventListener('resize', resize);

  let lastT = performance.now();
  function render(eye) {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    cube.rotation.y += 0.6 * dt;
    cube.rotation.x += 0.3 * dt;

    buildOffAxisProjection({ pa, pb, pc, pe: eye, near: 0.05, far: 50, camera });
    camera.matrixWorld.compose(camera.position, camera.quaternion, camera.scale);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    renderer.render(scene, camera);
  }

  function dispose() {
    window.removeEventListener('resize', resize);
    renderer.dispose();
  }

  return { render, dispose };
}

// ── RGB wireframe cube ───────────────────────────────────────────────────────

function buildRgbCube(size) {
  const s = size / 2;
  // 8 corners with vertex-position-derived RGB.
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const x = (i & 1) ? s : -s;
    const y = (i & 2) ? s : -s;
    const z = (i & 4) ? s : -s;
    const r = (i & 1) ? 1 : 0;
    const g = (i & 2) ? 1 : 0;
    const b = (i & 4) ? 1 : 0;
    corners.push({ pos: [x, y, z], col: [r, g, b] });
  }

  // 12 edges as pairs of corner indices.
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], // along X
    [0, 2], [1, 3], [4, 6], [5, 7], // along Y
    [0, 4], [1, 5], [2, 6], [3, 7], // along Z
  ];

  const positions = new Float32Array(edges.length * 2 * 3);
  const colors    = new Float32Array(edges.length * 2 * 3);
  edges.forEach(([a, b], i) => {
    const ca = corners[a], cb = corners[b];
    positions.set(ca.pos, i * 6);
    positions.set(cb.pos, i * 6 + 3);
    colors.set(ca.col, i * 6);
    colors.set(cb.col, i * 6 + 3);
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: false,
    linewidth: 1,
  });

  return new THREE.LineSegments(geom, mat);
}

// ── Five-wall wireframe-grid room ────────────────────────────────────────────

function buildRoom(divs) {
  const group = new THREE.Group();
  const halfW = ROOM_W / 2;
  const halfH = ROOM_H / 2;

  // Each wall is a rectangle in 3D; we generate grid lines spanning two axes.
  // Wall spec: { u: [3 axis floats], v: [3], origin: [3] }
  // Lines run along u (varying v) and along v (varying u).

  const walls = [
    // Back wall (z = -ROOM_D) spans X (u) and Y (v).
    { u: [ROOM_W, 0, 0], v: [0, ROOM_H, 0], o: [-halfW, -halfH, -ROOM_D] },
    // Top (y = halfH) spans X and -Z.
    { u: [ROOM_W, 0, 0], v: [0, 0, -ROOM_D], o: [-halfW,  halfH, 0] },
    // Bottom (y = -halfH) spans X and -Z.
    { u: [ROOM_W, 0, 0], v: [0, 0, -ROOM_D], o: [-halfW, -halfH, 0] },
    // Left (x = -halfW) spans -Z and Y.
    { u: [0, 0, -ROOM_D], v: [0, ROOM_H, 0], o: [-halfW, -halfH, 0] },
    // Right (x = halfW) spans -Z and Y.
    { u: [0, 0, -ROOM_D], v: [0, ROOM_H, 0], o: [ halfW, -halfH, 0] },
  ];

  for (const wall of walls) {
    group.add(makeGridWall(wall.u, wall.v, wall.o, divs));
  }
  return group;
}

function makeGridWall(u, v, origin, divs) {
  const positions = [];
  // Lines along u (constant v at each step).
  for (let i = 0; i <= divs; i++) {
    const t = i / divs;
    const sx = origin[0] + v[0] * t;
    const sy = origin[1] + v[1] * t;
    const sz = origin[2] + v[2] * t;
    positions.push(sx, sy, sz, sx + u[0], sy + u[1], sz + u[2]);
  }
  // Lines along v.
  for (let i = 0; i <= divs; i++) {
    const t = i / divs;
    const sx = origin[0] + u[0] * t;
    const sy = origin[1] + u[1] * t;
    const sz = origin[2] + u[2] * t;
    positions.push(sx, sy, sz, sx + v[0], sy + v[1], sz + v[2]);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: WALL_COLOR,
    transparent: true,
    opacity: WALL_OPACITY,
  });
  return new THREE.LineSegments(geom, mat);
}

export const ROOM_DIMS = { W: ROOM_W, H: ROOM_H, D: ROOM_D };
