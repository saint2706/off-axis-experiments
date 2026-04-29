// Canvas-2D fallback scene for browsers without WebGL.
// Renders the same RGB cube + five-wall room using CPU 3D math + 2D line
// rasterization. No Three.js dependency.

import {
  computeOffAxisMatrices,
  transformPoint,
  multiplyMatrices,
} from './offaxis-math.js';

const ROOM_W = 2.4;
const ROOM_H = 1.6;
const ROOM_D = 1.6;

const WALL_STROKE = 'rgba(43, 216, 255, 0.45)';
const CUBE_LINE_WIDTH_DESKTOP = 2;
const CUBE_LINE_WIDTH_MOBILE  = 1.5;

export function createCanvas2DScene(canvas) {
  const isMobile = window.innerWidth < 768;
  const divs = isMobile ? 8 : 14;
  const dpr = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2);

  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = Math.round(window.innerWidth  * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  // Pre-build static line lists (in their own object spaces).
  const cubeEdges = buildCubeEdges(0.42); // per-edge endpoints with rgb
  const wallLines = buildRoomLines(divs);  // world-space wall grid lines

  // Cube animation state.
  let yaw = 0;
  let pitch = 0;
  let lastT = performance.now();

  // Reusable virtual-screen corners.
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  const pc = [0, 0, 0];
  function updateScreenRect() {
    const aspect = window.innerWidth / window.innerHeight;
    const maxW = ROOM_W * 0.95;
    const maxH = ROOM_H * 0.95;
    let w = maxW, h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    pa[0] = -w / 2; pa[1] = -h / 2; pa[2] = 0;
    pb[0] =  w / 2; pb[1] = -h / 2; pb[2] = 0;
    pc[0] = -w / 2; pc[1] =  h / 2; pc[2] = 0;
  }

  function render(eye) {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    yaw   += 0.6 * dt;
    pitch += 0.3 * dt;

    updateScreenRect();
    const { proj, view, valid } = computeOffAxisMatrices({
      pa, pb, pc,
      pe: [eye.x, eye.y, eye.z],
      near: 0.05,
      far: 50,
    });
    if (!valid) return;

    const vp = multiplyMatrices(proj, view);
    const cubeModel = makeCubeModel(yaw, pitch, 0, 0, -ROOM_D * 0.55);
    const cubeMVP = multiplyMatrices(vp, cubeModel);

    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, W, H);

    drawWalls(ctx, wallLines, vp, W, H);
    drawCube(ctx, cubeEdges, cubeMVP, W, H, isMobile);
  }

  function dispose() {
    window.removeEventListener('resize', resize);
  }

  return { render, dispose };
}

// ── Cube ─────────────────────────────────────────────────────────────────────

function buildCubeEdges(size) {
  const s = size / 2;
  const corners = [];
  for (let i = 0; i < 8; i++) {
    corners.push({
      pos: [
        (i & 1) ? s : -s,
        (i & 2) ? s : -s,
        (i & 4) ? s : -s,
      ],
      col: [
        (i & 1) ? 255 : 0,
        (i & 2) ? 255 : 0,
        (i & 4) ? 255 : 0,
      ],
    });
  }
  const idx = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return idx.map(([a, b]) => ({
    a: corners[a].pos,
    b: corners[b].pos,
    ca: corners[a].col,
    cb: corners[b].col,
  }));
}

function makeCubeModel(yaw, pitch, tx, ty, tz) {
  const cy = Math.cos(yaw),   sy = Math.sin(yaw);
  const cx = Math.cos(pitch), sx = Math.sin(pitch);
  // Row-major Ry * Rx, then translate.
  // Ry = [[cy,0,sy,0],[0,1,0,0],[-sy,0,cy,0],[0,0,0,1]]
  // Rx = [[1,0,0,0],[0,cx,-sx,0],[0,sx,cx,0],[0,0,0,1]]
  // M = Ry * Rx (then translation column).
  return new Float32Array([
    cy,  sy * sx,  sy * cx,  tx,
    0,   cx,      -sx,       ty,
    -sy, cy * sx,  cy * cx,  tz,
    0,   0,        0,        1,
  ]);
}

function drawCube(ctx, edges, mvp, W, H, isMobile) {
  ctx.lineWidth = (isMobile ? CUBE_LINE_WIDTH_MOBILE : CUBE_LINE_WIDTH_DESKTOP) *
                  (W / window.innerWidth);
  ctx.lineCap = 'round';

  for (const e of edges) {
    const c0 = transformPoint(mvp, e.a);
    const c1 = transformPoint(mvp, e.b);
    const clipped = clipLineNear(c0, c1, e.ca, e.cb, 0.05);
    if (!clipped) continue;
    const [p0, p1, col0, col1] = clipped;
    const s0 = ndcToScreen(p0, W, H);
    const s1 = ndcToScreen(p1, W, H);
    const grad = ctx.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
    grad.addColorStop(0, `rgb(${col0[0]},${col0[1]},${col0[2]})`);
    grad.addColorStop(1, `rgb(${col1[0]},${col1[1]},${col1[2]})`);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(s0[0], s0[1]);
    ctx.lineTo(s1[0], s1[1]);
    ctx.stroke();
  }
}

// ── Room walls ───────────────────────────────────────────────────────────────

function buildRoomLines(divs) {
  const halfW = ROOM_W / 2, halfH = ROOM_H / 2;
  const walls = [
    { u: [ROOM_W, 0, 0],  v: [0, ROOM_H, 0],  o: [-halfW, -halfH, -ROOM_D] },
    { u: [ROOM_W, 0, 0],  v: [0, 0, -ROOM_D], o: [-halfW,  halfH, 0] },
    { u: [ROOM_W, 0, 0],  v: [0, 0, -ROOM_D], o: [-halfW, -halfH, 0] },
    { u: [0, 0, -ROOM_D], v: [0, ROOM_H, 0],  o: [-halfW, -halfH, 0] },
    { u: [0, 0, -ROOM_D], v: [0, ROOM_H, 0],  o: [ halfW, -halfH, 0] },
  ];
  const lines = [];
  for (const w of walls) {
    for (let i = 0; i <= divs; i++) {
      const t = i / divs;
      const o0 = [w.o[0] + w.v[0] * t, w.o[1] + w.v[1] * t, w.o[2] + w.v[2] * t];
      const o1 = [o0[0] + w.u[0], o0[1] + w.u[1], o0[2] + w.u[2]];
      lines.push({ a: o0, b: o1 });
    }
    for (let i = 0; i <= divs; i++) {
      const t = i / divs;
      const o0 = [w.o[0] + w.u[0] * t, w.o[1] + w.u[1] * t, w.o[2] + w.u[2] * t];
      const o1 = [o0[0] + w.v[0], o0[1] + w.v[1], o0[2] + w.v[2]];
      lines.push({ a: o0, b: o1 });
    }
  }
  return lines;
}

function drawWalls(ctx, lines, vp, W, H) {
  ctx.lineWidth = Math.max(1, (W / window.innerWidth));
  ctx.strokeStyle = WALL_STROKE;
  ctx.beginPath();
  for (const ln of lines) {
    const c0 = transformPoint(vp, ln.a);
    const c1 = transformPoint(vp, ln.b);
    // Walls: clip without color interpolation.
    const clipped = clipLineNear(c0, c1, null, null, 0.05);
    if (!clipped) continue;
    const [p0, p1] = clipped;
    const s0 = ndcToScreen(p0, W, H);
    const s1 = ndcToScreen(p1, W, H);
    ctx.moveTo(s0[0], s0[1]);
    ctx.lineTo(s1[0], s1[1]);
  }
  ctx.stroke();
}

// ── Clipping / projection helpers ────────────────────────────────────────────

function clipLineNear(c0, c1, col0, col1, eps) {
  const w0 = c0[3], w1 = c1[3];
  if (w0 <= eps && w1 <= eps) return null;
  if (w0 > eps && w1 > eps) return [c0, c1, col0, col1];
  const t = (eps - w0) / (w1 - w0);
  const interp = [
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t,
    eps,
  ];
  let icol = null;
  if (col0 && col1) {
    icol = [
      col0[0] + (col1[0] - col0[0]) * t,
      col0[1] + (col1[1] - col0[1]) * t,
      col0[2] + (col1[2] - col0[2]) * t,
    ];
  }
  if (w0 <= eps) return [interp, c1, icol, col1];
  return [c0, interp, col0, icol];
}

function ndcToScreen(clip, W, H) {
  const invW = 1 / clip[3];
  const ndx = clip[0] * invW;
  const ndy = clip[1] * invW;
  return [
    (ndx * 0.5 + 0.5) * W,
    (1 - (ndy * 0.5 + 0.5)) * H,
  ];
}
