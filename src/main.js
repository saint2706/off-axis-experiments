// Boot: feature-detect WebGL, dynamically load the matching scene module so
// browsers without WebGL never download Three.js, then drive the render loop
// from EyeInput.

import { EyeInput } from './inputs.js';

const canvas    = document.getElementById('canvas');
const statusEl  = document.getElementById('status');
const tiltBtn   = document.getElementById('btn-tilt');
const webcamBtn = document.getElementById('btn-webcam');
const fallbackNote = document.getElementById('fallback-note');

const params  = new URLSearchParams(location.search);
const forceFb = params.get('fallback') === '1';

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot() {
  let scene;

  if (!forceFb && hasWebGL()) {
    try {
      const mod = await import('./scene-webgl.js');
      scene = mod.createWebGLScene(canvas);
    } catch (err) {
      console.warn('WebGL scene failed to load, falling back:', err);
      scene = await loadFallback();
    }
  } else {
    scene = await loadFallback();
  }

  if (!scene) return;

  const input = new EyeInput({ statusEl, tiltBtn, webcamBtn });

  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(loop);
  });

  function loop() {
    if (!running) return;
    const eye = input.getEye();
    scene.render(eye);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

async function loadFallback() {
  if (fallbackNote) fallbackNote.style.display = 'block';
  try {
    const mod = await import('./scene-canvas2d.js');
    return mod.createCanvas2DScene(canvas);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent =
        'Your browser cannot run this demo. Please try a modern browser.';
    }
    console.error(err);
    return null;
  }
}

boot();
