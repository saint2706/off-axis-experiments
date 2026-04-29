// Pure-math half of the off-axis projection — no Three.js dependency.
// Used by the Canvas-2D fallback path so browsers without WebGL never load
// Three.js.

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a) {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

function identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

// Returns row-major proj/view 4x4s (Float32Array(16)) plus a `valid` flag.
export function computeOffAxisMatrices({ pa, pb, pc, pe, near, far }) {
  const vr = norm(sub(pb, pa));
  const vu = norm(sub(pc, pa));
  const vn = norm(cross(vr, vu));

  const va = sub(pa, pe);
  const vb = sub(pb, pe);
  const vc = sub(pc, pe);

  const d = -dot(va, vn);
  if (d < 1e-4) return { proj: identity(), view: identity(), valid: false };

  const nd = near / d;
  const l = dot(vr, va) * nd;
  const r = dot(vr, vb) * nd;
  const b = dot(vu, va) * nd;
  const t = dot(vu, vc) * nd;

  const x = (2 * near) / (r - l);
  const y = (2 * near) / (t - b);
  const A = (r + l) / (r - l);
  const B = (t + b) / (t - b);
  const C = -(far + near) / (far - near);
  const D = -(2 * far * near) / (far - near);

  const proj = new Float32Array([
    x, 0, A, 0,
    0, y, B, 0,
    0, 0, C, D,
    0, 0, -1, 0,
  ]);

  // View matrix: rows are camera right, up, forward (Three.js convention
  // looks down -Z, so the third row is -screen-normal).
  const view = new Float32Array(16);
  view[0]  = vr[0]; view[1]  = vr[1]; view[2]  = vr[2];  view[3]  = -dot(vr, pe);
  view[4]  = vu[0]; view[5]  = vu[1]; view[6]  = vu[2];  view[7]  = -dot(vu, pe);
  view[8]  = vn[0]; view[9]  = vn[1]; view[10] = vn[2];  view[11] = -dot(vn, pe);
  view[12] = 0; view[13] = 0; view[14] = 0; view[15] = 1;

  return { proj, view, valid: true };
}

// Multiply a row-major 4x4 by a 3D point. Returns clip-space [x, y, z, w].
export function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
    m[12] * x + m[13] * y + m[14] * z + m[15],
  ];
}

// Multiply two row-major 4x4 matrices: out = a * b.
export function multiplyMatrices(a, b) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}
