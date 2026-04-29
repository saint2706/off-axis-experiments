import * as THREE from 'three';

// ─── Fast trig lookup tables (replaces Math.sin/cos in the 4k-particle hot loop) ──
const TBL      = 4096;
const TBL_MASK = TBL - 1;
const INV_2PI  = TBL / (Math.PI * 2);
const SIN_TBL  = new Float32Array(TBL);
const COS_TBL  = new Float32Array(TBL);
for (let i = 0; i < TBL; i++) {
  const a = (i / TBL) * Math.PI * 2;
  SIN_TBL[i] = Math.sin(a);
  COS_TBL[i] = Math.cos(a);
}
function fastSin(x) { return SIN_TBL[(x * INV_2PI | 0) & TBL_MASK]; }
function fastCos(x) { return COS_TBL[(x * INV_2PI | 0) & TBL_MASK]; }

// ─── Fire colour palette LUTs (256 steps, eliminates per-particle function calls) ─
const CLR_R = new Float32Array(256);
const CLR_G = new Float32Array(256);
const CLR_B = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const t = i / 255;
  CLR_R[i] = t < 0.5 ? 0.8 + t * 0.4 : 1.0;
  CLR_G[i] = t < 0.2  ? t * 0.5
           : t < 0.5  ? 0.1 + ((t - 0.2) / 0.3) * 0.5
           : t < 0.75 ? 0.6 + ((t - 0.5) / 0.25) * 0.4
           : 1.0;
  CLR_B[i] = t < 0.7 ? 0.0 : ((t - 0.7) / 0.3) * 0.5;
}

// ─── Alpha fade LUT (smoothstep 0.65→1.0) ─────────────────────────────────────
const ALPHA_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const t = i / 255;
  const s = t < 0.65 ? 0.0 : (t - 0.65) / 0.35;
  ALPHA_LUT[i] = 1.0 - s * s * (3.0 - 2.0 * s);
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT = /* glsl */`
attribute float size;
varying vec3  vColor;

void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // perspective attenuation — 300 is tuned for a ~1.6-unit-wide virtual screen
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position  = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
varying vec3 vColor;

void main() {
  vec2  uv   = gl_PointCoord - vec2(0.5);
  float dist = length(uv);
  if (dist > 0.5) discard;
  float t = clamp((dist - 0.25) / 0.25, 0.0, 1.0);
  float alpha = 1.0 - t * t * (3.0 - 2.0 * t);
  gl_FragColor = vec4(vColor * alpha, alpha);
}
`;

// ─── Spawn / respawn a single particle ────────────────────────────────────────

function respawn(i, sys) {
  const angle  = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()); // uniform-disk sampling
  const bx = Math.cos(angle) * 0.22 * radius;
  const bz = Math.sin(angle) * 0.08 * radius;

  sys.baseX[i] = bx;
  sys.baseZ[i] = bz;

  const i3 = i * 3;
  // Fire base centred on the virtual screen (y=-0.5 sits at screen-bottom edge,
  // flame body rises through screen centre and beyond the top edge)
  sys.positions[i3]     = bx;
  sys.positions[i3 + 1] = -0.5;
  sys.positions[i3 + 2] = -0.3 + bz;

  sys.velocities[i3]     = (Math.random() - 0.5) * 0.008;
  sys.velocities[i3 + 1] = 0.012 + Math.random() * 0.018;
  sys.velocities[i3 + 2] = (Math.random() - 0.5) * 0.004;

  sys.ages[i]     = 0;
  sys.lifetimes[i] = 60 + Math.floor(Math.random() * 90); // 60–150 frames
  // Random size frozen at spawn — avoids Math.random() in the per-frame loop
  sys.sizeBase[i]  = 16 + Math.random() * 12;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a fire particle system and add it to the scene.
 * @param {THREE.Scene} scene
 * @param {number} count  Number of particles (default 4000; use ~1500 on mobile)
 * @returns {Object} fireSys — pass to updateFire() each frame
 */
export function createFire(scene, count = 4000) {
  const positions  = new Float32Array(count * 3);
  const colors     = new Float32Array(count * 3);
  const sizes      = new Float32Array(count);
  const velocities = new Float32Array(count * 3);
  const ages       = new Int32Array(count);
  const lifetimes  = new Int32Array(count);
  const baseX      = new Float32Array(count);
  const baseZ      = new Float32Array(count);
  const sizeBase   = new Float32Array(count);
  // Per-particle trig phase offsets — computed once, reused every frame
  const phaseX1    = new Float32Array(count);   // i * 0.17
  const phaseX2    = new Float32Array(count);   // i * 0.41
  const phaseZ1    = new Float32Array(count);   // i * 0.23

  for (let i = 0; i < count; i++) {
    phaseX1[i] = i * 0.17;
    phaseX2[i] = i * 0.41;
    phaseZ1[i] = i * 0.23;
    // Start all particles dead so they stagger in rather than popping all at once
    ages[i]     = 999;
    lifetimes[i] = 1;
    sizeBase[i]  = 16;
    positions[i * 3 + 1] = -100; // off-screen while dead
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));

  const mat = new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    blending:       THREE.AdditiveBlending,
    depthWrite:     false,
    transparent:    true,
    vertexColors:   true,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  return { geo, points, count, positions, colors, sizes, velocities, ages, lifetimes,
           baseX, baseZ, sizeBase, phaseX1, phaseX2, phaseZ1 };
}

/**
 * Advance the fire simulation by one frame. Call this once per animation tick.
 * @param {Object} sys  Return value of createFire()
 */
export function updateFire(sys) {
  const { positions, velocities, colors, sizes, ages, lifetimes, count,
          sizeBase, phaseX1, phaseX2, phaseZ1 } = sys;
  const time = performance.now() * 0.001;

  // Pre-multiply time factors once per frame (saves count multiplications)
  const t13 = time * 1.3;
  const t31 = time * 3.1;
  const t17 = time * 1.7;

  for (let i = 0; i < count; i++) {
    ages[i]++;
    const t = ages[i] / lifetimes[i]; // normalised age 0→1

    if (t >= 1.0) { respawn(i, sys); continue; }

    const i3 = i * 3;

    // Turbulence via LUT — far cheaper than Math.sin/cos on mobile
    const tx = fastSin(t13 + phaseX1[i]) * 0.003 + fastSin(t31 + phaseX2[i]) * 0.001;
    const tz = fastCos(t17 + phaseZ1[i]) * 0.002;

    positions[i3]     += velocities[i3]     + tx;
    positions[i3 + 1] += velocities[i3 + 1] * (1.0 - t * 0.4); // slow as it rises
    positions[i3 + 2] += velocities[i3 + 2] + tz;

    // Slight lateral drag
    velocities[i3]     *= 0.995;
    velocities[i3 + 2] *= 0.995;

    const ti    = t * 255 | 0; // 0..254 LUT index (t < 1.0 guaranteed above)
    const alpha = ALPHA_LUT[ti];

    colors[i3]     = CLR_R[ti];
    colors[i3 + 1] = CLR_G[ti];
    colors[i3 + 2] = CLR_B[ti];

    sizes[i] = sizeBase[i] * (1.0 - t * 0.55) * alpha;
  }

  sys.geo.attributes.position.needsUpdate = true;
  sys.geo.attributes.color.needsUpdate    = true;
  sys.geo.attributes.size.needsUpdate     = true;
}
