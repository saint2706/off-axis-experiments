import * as THREE from 'three';

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

float smoothstep_custom(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec2  uv   = gl_PointCoord - vec2(0.5);
  float dist = length(uv);
  if (dist > 0.5) discard;
  float alpha = 1.0 - smoothstep_custom(0.25, 0.5, dist);
  gl_FragColor = vec4(vColor * alpha, alpha);
}
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Fire colour palette: maps normalised age t ∈ [0,1] → RGB
function fireR(t) {
  return t < 0.5 ? 0.8 + t * 0.4 : 1.0;
}
function fireG(t) {
  if (t < 0.2) return t * 0.5;                         // dark-red → red
  if (t < 0.5) return 0.1 + ((t - 0.2) / 0.3) * 0.5; // red → orange
  if (t < 0.75) return 0.6 + ((t - 0.5) / 0.25) * 0.4; // orange → yellow
  return 1.0;
}
function fireB(t) {
  return t < 0.7 ? 0.0 : ((t - 0.7) / 0.3) * 0.5; // slight blue at tip → near-white
}

// ─── Spawn / respawn a single particle ────────────────────────────────────────

function respawn(i, sys) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()); // uniform-disk sampling
  const bx = Math.cos(angle) * 0.22 * radius;
  const bz = Math.sin(angle) * 0.08 * radius;

  sys.baseX[i] = bx;
  sys.baseZ[i] = bz;

  // Fire base sits at y = -0.8, slightly behind the virtual screen (z = -0.2)
  sys.positions[i * 3 + 0] = bx;
  sys.positions[i * 3 + 1] = -0.8;
  sys.positions[i * 3 + 2] = -0.2 + bz;

  sys.velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.008;
  sys.velocities[i * 3 + 1] = 0.012 + Math.random() * 0.018;
  sys.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.004;

  sys.ages[i] = 0;
  sys.lifetimes[i] = 60 + Math.floor(Math.random() * 90); // 60–150 frames
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a fire particle system and add it to the scene.
 * @param {THREE.Scene} scene
 * @param {number} count  Number of particles (default 4000)
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

  const sys = { geo, points, count, positions, colors, sizes, velocities, ages, lifetimes, baseX, baseZ };

  // Start all particles as dead so they stagger in rather than popping all at once
  for (let i = 0; i < count; i++) {
    ages[i] = 999;
    lifetimes[i] = 1;
    // Scatter them off-screen so the "dead" positions don't flash
    positions[i * 3 + 1] = -100;
  }

  return sys;
}

/**
 * Advance the fire simulation by one frame. Call this once per animation tick.
 * @param {Object} sys  Return value of createFire()
 */
export function updateFire(sys) {
  const { positions, velocities, colors, sizes, ages, lifetimes, count } = sys;
  const time = performance.now() * 0.001;

  for (let i = 0; i < count; i++) {
    ages[i]++;
    const t = ages[i] / lifetimes[i]; // normalised age 0→1

    if (t >= 1.0) {
      respawn(i, sys);
      continue;
    }

    // Sin-harmonic turbulence — no external library required
    const tx = Math.sin(time * 1.3 + i * 0.17) * 0.003
             + Math.sin(time * 3.1 + i * 0.41) * 0.001;
    const tz = Math.cos(time * 1.7 + i * 0.23) * 0.002;

    positions[i * 3 + 0] += velocities[i * 3 + 0] + tx;
    positions[i * 3 + 1] += velocities[i * 3 + 1] * (1 - t * 0.4); // slow as it rises
    positions[i * 3 + 2] += velocities[i * 3 + 2] + tz;

    // Slight lateral drag
    velocities[i * 3 + 0] *= 0.995;
    velocities[i * 3 + 2] *= 0.995;

    // Fade alpha into end-of-life
    const alpha = 1.0 - smoothstep(0.65, 1.0, t);

    colors[i * 3 + 0] = fireR(t);
    colors[i * 3 + 1] = fireG(t);
    colors[i * 3 + 2] = fireB(t);

    sizes[i] = (16 + Math.random() * 12) * (1 - t * 0.55) * alpha;
  }

  sys.geo.attributes.position.needsUpdate = true;
  sys.geo.attributes.color.needsUpdate    = true;
  sys.geo.attributes.size.needsUpdate     = true;
}
