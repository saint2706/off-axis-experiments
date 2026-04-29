// EyeInput: collects viewer-position cues from mouse / touch / device tilt /
// optional webcam face tracking, smooths them, and exposes a clamped
// {x, y, z} eye position in world space.

const EYE_DEFAULT = { x: 0, y: 0, z: 1.4 };
const CLAMP = { x: 0.6, y: 0.4, zMin: 0.4, zMax: 2.6 };
const SMOOTH = 0.18; // lerp factor applied each frame

export class EyeInput {
  constructor({ statusEl, tiltBtn, webcamBtn } = {}) {
    this.statusEl  = statusEl  || null;
    this.tiltBtn   = tiltBtn   || null;
    this.webcamBtn = webcamBtn || null;

    this.target  = { ...EYE_DEFAULT };
    this.current = { ...EYE_DEFAULT };
    this.mode    = 'pointer';

    this._lastPointer = 0;
    this._lastTilt    = 0;
    this._lastWebcam  = 0;

    this._setupPointer();
    this._setupTilt();
    this._setupWebcam();
    this._setStatus('Move the mouse or drag to shift perspective');
  }

  _setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // Called from the render loop. Smoothly approaches target.
  getEye() {
    this.current.x += (this.target.x - this.current.x) * SMOOTH;
    this.current.y += (this.target.y - this.current.y) * SMOOTH;
    this.current.z += (this.target.z - this.current.z) * SMOOTH;
    return this.current;
  }

  _setTarget(x, y, z) {
    this.target.x = clamp(x, -CLAMP.x, CLAMP.x);
    this.target.y = clamp(y, -CLAMP.y, CLAMP.y);
    this.target.z = clamp(z,  CLAMP.zMin, CLAMP.zMax);
  }

  // ── Pointer (mouse + most touch via pointer events) ───────────────────────
  _setupPointer() {
    const onMove = (e) => {
      // Only listen to pointer if it's the most recent input source.
      // (Tilt and webcam will overwrite when they're more recent.)
      this._lastPointer = performance.now();
      if (this._isStaler('_lastPointer')) return;
      const nx = (e.clientX / window.innerWidth  - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      this._setTarget(nx * 0.45, -ny * 0.32, this.target.z);
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    // Pinch-to-zoom-style: wheel adjusts depth on desktop.
    window.addEventListener('wheel', (e) => {
      this.target.z = clamp(this.target.z + e.deltaY * 0.001,
                            CLAMP.zMin, CLAMP.zMax);
    }, { passive: true });

    // Touch fallback for browsers where pointer events don't fire on touch.
    window.addEventListener('touchmove', (e) => {
      if (!e.touches.length) return;
      e.preventDefault();
      this._lastPointer = performance.now();
      if (this._isStaler('_lastPointer')) return;
      const t = e.touches[0];
      const nx = (t.clientX / window.innerWidth  - 0.5) * 2;
      const ny = (t.clientY / window.innerHeight - 0.5) * 2;
      this._setTarget(nx * 0.45, -ny * 0.32, this.target.z);
    }, { passive: false });
  }

  // ── Device orientation (mobile tilt) ──────────────────────────────────────
  _setupTilt() {
    if (!this.tiltBtn) return;
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      this.tiltBtn.style.display = 'none';
      return;
    }
    this.tiltBtn.style.display = '';
    const needsPermission =
      typeof window.DeviceOrientationEvent.requestPermission === 'function';

    const attach = () => {
      window.addEventListener('deviceorientation', (e) => {
        if (e.beta == null || e.gamma == null) return;
        // gamma: left/right tilt -90..90; beta: front/back -180..180
        const nx = clamp(e.gamma / 30, -1, 1);
        const ny = clamp((e.beta - 30) / 30, -1, 1);
        this._lastTilt = performance.now();
        this.mode = 'tilt';
        this._setTarget(nx * 0.45, -ny * 0.32, this.target.z);
      });
      this._setStatus('Tilt mode — move your phone to shift perspective');
      this.tiltBtn.style.display = 'none';
    };

    this.tiltBtn.addEventListener('click', () => {
      if (needsPermission) {
        window.DeviceOrientationEvent.requestPermission()
          .then((res) => { if (res === 'granted') attach(); })
          .catch(() => { /* user denied; leave button visible */ });
      } else {
        attach();
      }
    });
  }

  // ── Webcam head tracking via MediaPipe FaceMesh (opt-in) ──────────────────
  _setupWebcam() {
    if (!this.webcamBtn) return;
    if (typeof window.FaceMesh === 'undefined' ||
        typeof window.Camera   === 'undefined') {
      this.webcamBtn.style.display = 'none';
      return;
    }
    this.webcamBtn.style.display = '';

    this.webcamBtn.addEventListener('click', () => {
      this.webcamBtn.disabled = true;
      this._setStatus('Requesting camera…');
      this._startWebcam()
        .then(() => {
          this._setStatus('Webcam tracking active');
          this.webcamBtn.style.display = 'none';
        })
        .catch(() => {
          this._setStatus('Camera denied — using pointer');
          this.webcamBtn.disabled = false;
        });
    });
  }

  _startWebcam() {
    return new Promise((resolve, reject) => {
      const faceMesh = new window.FaceMesh({
        locateFile: (f) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      faceMesh.onResults((results) => {
        if (!results.multiFaceLandmarks?.length) return;
        const lm = results.multiFaceLandmarks[0];
        const nose = lm[1];
        const nx = -(nose.x - 0.5) * 2; // mirror selfie
        const ny =  (nose.y - 0.5) * 2;
        const le = lm[33], re = lm[263];
        const iod = Math.hypot(le.x - re.x, le.y - re.y);
        const z = clamp(0.065 / Math.max(iod, 0.015) * 0.6,
                        CLAMP.zMin, CLAMP.zMax);
        this._lastWebcam = performance.now();
        this.mode = 'webcam';
        this._setTarget(nx * 0.45, -ny * 0.32, z);
      });

      const video = document.createElement('video');
      video.style.display = 'none';
      video.playsInline = true;
      document.body.appendChild(video);

      const cam = new window.Camera(video, {
        onFrame: async () => { await faceMesh.send({ image: video }); },
        width: 320,
        height: 240,
      });
      cam.start().then(resolve).catch(reject);
    });
  }

  // Returns true if the named timestamp is older than the most recent one.
  _isStaler(key) {
    const mine = this[key];
    return Math.max(this._lastPointer, this._lastTilt, this._lastWebcam) > mine;
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
