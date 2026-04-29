import * as THREE from 'three';
import { buildOffAxisProjection } from './offaxis.js';
import { createFire, updateFire } from './fire.js';

// ─── Renderer ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);

// ─── Scene ────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene();

// Optional: a subtle ground plane to catch fire glow
const groundGeo  = new THREE.PlaneGeometry(3, 3);
const groundMat  = new THREE.MeshStandardMaterial({ color: 0x1a0800, roughness: 1 });
const ground     = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.82, -0.5);
scene.add(ground);

// Ambient glow from fire base
const fireLight = new THREE.PointLight(0xff5500, 3, 4);
fireLight.position.set(0, -0.6, -0.2);
scene.add(fireLight);

// Very dim ambient so the ground plane is barely visible
scene.add(new THREE.AmbientLight(0x110500, 1));

// ─── Camera ───────────────────────────────────────────────────────────────────

// fov/aspect are overridden by buildOffAxisProjection — these are dummy values
const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
// Disable Three.js auto-update so our manual matrixWorld compose is authoritative
camera.matrixAutoUpdate = false;

// ─── Virtual screen definition (world space, z = 0 plane) ────────────────────
// 16:9 rectangle centred at origin; fire lives behind it (z < 0)

const SCREEN_W = 1.6;
const SCREEN_H = 0.9;
const pa = new THREE.Vector3(-SCREEN_W / 2, -SCREEN_H / 2, 0); // bottom-left
const pb = new THREE.Vector3( SCREEN_W / 2, -SCREEN_H / 2, 0); // bottom-right
const pc = new THREE.Vector3(-SCREEN_W / 2,  SCREEN_H / 2, 0); // top-left

// ─── Eye position ─────────────────────────────────────────────────────────────

const eyePos = new THREE.Vector3(0, 0, 1.5);

function setEye(x, y, z) {
  eyePos.x = THREE.MathUtils.clamp(x, -0.55, 0.55);
  eyePos.y = THREE.MathUtils.clamp(y, -0.38, 0.38);
  eyePos.z = THREE.MathUtils.clamp(z,   0.3,  3.0); // never behind screen
}

// ─── Fire system ──────────────────────────────────────────────────────────────

const fire = createFire(scene, 4000);

// Pulse the fire light intensity with the animation
let lightPhase = 0;

// ─── Status UI helper ─────────────────────────────────────────────────────────

const statusEl = document.getElementById('status');
function setStatus(msg) { statusEl.textContent = msg; }

// ─── Head Tracker ─────────────────────────────────────────────────────────────

class HeadTracker {
  constructor() {
    this.mode    = 'mouse';
    this._mouseZ = 1.5;
    this._initMouse();
    this._tryWebcam();
  }

  _initMouse() {
    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'mouse') return;
      const nx = (e.clientX / window.innerWidth  - 0.5) * 2; // -1..+1
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      setEye(nx * 0.45, -ny * 0.32, this._mouseZ);
    });

    window.addEventListener('wheel', (e) => {
      if (this.mode !== 'mouse') return;
      this._mouseZ = THREE.MathUtils.clamp(this._mouseZ + e.deltaY * 0.001, 0.4, 2.8);
    }, { passive: true });

    setStatus('Mouse mode — move to shift perspective | scroll to zoom');
  }

  _tryWebcam() {
    if (typeof window.FaceMesh === 'undefined') {
      setStatus('Mouse mode (MediaPipe unavailable) — move to shift perspective');
      return;
    }

    const faceMesh = new window.FaceMesh({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`,
    });

    faceMesh.setOptions({
      maxNumFaces:            1,
      refineLandmarks:        false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence:  0.5,
    });

    faceMesh.onResults((results) => {
      if (!results.multiFaceLandmarks?.length) return;
      const lm = results.multiFaceLandmarks[0];

      // Landmark 1 = nose tip — good stable proxy for head centre
      const nose = lm[1];
      // Selfie cam: nose.x increases left→right in video = viewer's right
      // Mirror so moving viewer's head right shifts scene right
      const nx = -(nose.x - 0.5) * 2;
      const ny =  (nose.y - 0.5) * 2;

      // Estimate depth from inter-ocular distance (landmarks 33 & 263)
      const le = lm[33], re = lm[263];
      const iod = Math.hypot(le.x - re.x, le.y - re.y);
      // 0.065 IOD ≈ 60 cm; scale to world units
      const zEst = THREE.MathUtils.clamp(0.065 / Math.max(iod, 0.015) * 0.6, 0.3, 2.5);

      setEye(nx * 0.45, -ny * 0.32, zEst);
    });

    // Video element must be in the DOM for MediaPipe Camera utility
    const video = document.createElement('video');
    video.style.display = 'none';
    document.body.appendChild(video);

    const cam = new window.Camera(video, {
      onFrame: async () => { await faceMesh.send({ image: video }); },
      width:  320,
      height: 240,
    });

    setStatus('Requesting camera…');

    cam.start()
      .then(() => {
        this.mode = 'webcam';
        setStatus('Head tracking active');
      })
      .catch(() => {
        this.mode = 'mouse';
        document.getElementById('permission-prompt').style.display = 'block';
        setStatus('Mouse mode (camera denied) — move to shift perspective');
      });
  }
}

// Boot tracker after a short delay so the page paints first
setTimeout(() => new HeadTracker(), 100);

// ─── Resize ───────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  // No camera.aspect update — off-axis handles projection implicitly
});

// ─── Animation loop ───────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);

  // Update fire particles
  updateFire(fire);

  // Pulse the fire light
  lightPhase += 0.04;
  fireLight.intensity = 2.5 + Math.sin(lightPhase) * 0.8 + Math.sin(lightPhase * 2.3) * 0.4;

  // Rebuild off-axis projection from current eye position
  buildOffAxisProjection({ pa, pb, pc, pe: eyePos, near: 0.05, far: 50, camera });

  // Manually compose matrixWorld (matrixAutoUpdate = false)
  camera.matrixWorld.compose(camera.position, camera.quaternion, camera.scale);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  renderer.render(scene, camera);
}

animate();
