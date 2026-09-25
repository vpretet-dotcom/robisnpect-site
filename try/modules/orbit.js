/** MiniOrbit — orbit / pinch zoom / pan (Shift·right·middle / 3-finger). */
export function MiniOrbit(camera, dom, THREE, opts = {}) {
  const target = new THREE.Vector3(0.18, 0.14, 0);
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();
  offset.copy(camera.position).sub(target);
  spherical.setFromVector3(offset);
  let minPolar = 0.08, maxPolar = Math.PI / 2.05, minDist = 0.28, maxDist = 4.4;
  const panMin = { x: -1.35, y: 0.02, z: -1.35 };
  const panMax = { x: 1.35, y: 0.95, z: 1.35 };
  let enabled = true;
  const pointers = new Map();
  let mode = 'none';
  let pending = false, pendingPan = false;
  let lastX = 0, lastY = 0, pinchStart = 0;
  const sphDelta = { theta: 0, phi: 0 };
  let scale = 1;
  const panAccum = new THREE.Vector3();
  const vPan = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  let userInterrupted = false;

  const isCoarse = () => !!(opts.isCoarse && opts.isCoarse());
  const plateOwns = () => !!(opts.plateOwns && opts.plateOwns());

  function clampTarget() {
    target.x = Math.max(panMin.x, Math.min(panMax.x, target.x));
    target.y = Math.max(panMin.y, Math.min(panMax.y, target.y));
    target.z = Math.max(panMin.z, Math.min(panMax.z, target.z));
  }

  function accumulatePan(dx, dy) {
    const h = Math.max(dom.clientHeight, 1);
    offset.copy(camera.position).sub(target);
    const dist = offset.length();
    const fov = (camera.fov * Math.PI) / 180;
    const half = dist * Math.tan(fov * 0.5);
    const factor = (2 * half) / h;
    camera.updateMatrixWorld();
    vRight.setFromMatrixColumn(camera.matrixWorld, 0);
    vUp.setFromMatrixColumn(camera.matrixWorld, 1);
    vPan.copy(vRight).multiplyScalar(-dx * factor);
    panAccum.add(vPan);
    vPan.copy(vUp).multiplyScalar(dy * factor);
    panAccum.add(vPan);
  }

  function centroidN(n) {
    const pts = Array.from(pointers.values());
    let cx = 0, cy = 0, m = Math.min(n, pts.length);
    for (let i = 0; i < m; i++) { cx += pts[i].x; cy += pts[i].y; }
    return { x: cx / m, y: cy / m, pts };
  }

  function markUser() { userInterrupted = true; if (opts.onUserInput) opts.onUserInput(); }

  function onDown(e) {
    if (!enabled) return;
    if (e.pointerType === 'mouse' && e.button > 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { dom.setPointerCapture(e.pointerId); } catch (_) {}
    if (isCoarse()) {
      pending = false; pendingPan = false; mode = 'none';
      if (plateOwns()) return;
      if (pointers.size >= 2) {
        /* 2 fingers: pinch zoom + pan */
        mode = 'pinch'; markUser();
        const c2 = centroidN(2); lastX = c2.x; lastY = c2.y;
        pinchStart = Math.hypot(c2.pts[0].x - c2.pts[1].x, c2.pts[0].y - c2.pts[1].y) || 1;
      } else if (pointers.size === 1) {
        /* 1 finger: orbit */
        mode = 'rotate'; markUser();
        lastX = e.clientX; lastY = e.clientY;
      }
      return;
    }
    if (plateOwns()) { pending = false; pendingPan = false; mode = 'none'; return; }
    const wantPan = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    lastX = e.clientX; lastY = e.clientY;
    if (wantPan && (e.button === 1 || e.button === 2)) {
      mode = 'pan'; pending = false; pendingPan = false; markUser();
    } else if (wantPan) {
      mode = 'none'; pending = true; pendingPan = true;
    } else if (e.button === 0) {
      mode = 'none'; pending = true; pendingPan = false;
    }
  }

  function onMove(e) {
    if (!enabled || !pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (isCoarse()) {
      if (mode === 'pinch' && pointers.size >= 2) {
        const c = centroidN(2);
        accumulatePan(c.x - lastX, c.y - lastY);
        const dist = Math.hypot(c.pts[0].x - c.pts[1].x, c.pts[0].y - c.pts[1].y) || 1;
        scale *= pinchStart / dist;
        pinchStart = dist;
        lastX = c.x; lastY = c.y; markUser();
      } else if (mode === 'rotate' && pointers.size === 1) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        sphDelta.theta -= dx * 0.0055;
        sphDelta.phi -= dy * 0.0055;
        lastX = e.clientX; lastY = e.clientY; markUser();
      }
      return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (pending) {
      if (Math.hypot(dx, dy) < 3) return;
      mode = pendingPan ? 'pan' : 'rotate';
      pending = false; markUser();
    }
    if (mode === 'rotate') {
      sphDelta.theta -= dx * 0.005; sphDelta.phi -= dy * 0.005; markUser();
    } else if (mode === 'pan') {
      accumulatePan(dx, dy); markUser();
    }
    lastX = e.clientX; lastY = e.clientY;
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!pointers.size) { mode = 'none'; pending = false; pendingPan = false; }
    else if (isCoarse()) {
      if (pointers.size >= 2) {
        mode = 'pinch'; const c = centroidN(2); lastX = c.x; lastY = c.y;
        pinchStart = Math.hypot(c.pts[0].x - c.pts[1].x, c.pts[0].y - c.pts[1].y) || 1;
      } else if (pointers.size === 1) {
        mode = 'rotate';
        const p0 = Array.from(pointers.values())[0];
        lastX = p0.x; lastY = p0.y;
      } else mode = 'none';
    }
  }

  function onWheel(e) {
    if (!enabled) return;
    e.preventDefault();
    scale *= e.deltaY > 0 ? 1.08 : 0.92;
    markUser();
  }

  function onCtx(e) { e.preventDefault(); }

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', onCtx);

  function update() {
    if (!enabled && !opts.forceUpdate) return;
    spherical.theta += sphDelta.theta;
    spherical.phi += sphDelta.phi;
    spherical.phi = Math.max(minPolar, Math.min(maxPolar, spherical.phi));
    spherical.radius = Math.max(minDist, Math.min(maxDist, spherical.radius * scale));
    sphDelta.theta = 0; sphDelta.phi = 0; scale = 1;
    if (panAccum.lengthSq() > 0) {
      target.add(panAccum); panAccum.set(0, 0, 0); clampTarget();
    }
    offset.setFromSpherical(spherical);
    camera.position.copy(target).add(offset);
    /* never dive through floor or into the cell */
    if (camera.position.y < 0.08) {
      camera.position.y = 0.08;
      offset.copy(camera.position).sub(target);
      spherical.setFromVector3(offset);
      spherical.phi = Math.max(minPolar, Math.min(maxPolar, spherical.phi));
      spherical.radius = Math.max(minDist, Math.min(maxDist, spherical.radius));
      offset.setFromSpherical(spherical);
      camera.position.copy(target).add(offset);
      if (camera.position.y < 0.08) camera.position.y = 0.08;
    }
    camera.lookAt(target);
  }

  return {
    update,
    get target() { return target; },
    setTarget(x, y, z) { target.set(x, y, z); clampTarget(); },
    setSpherical(theta, phi, radius) {
      spherical.theta = theta;
      spherical.phi = Math.max(minPolar, Math.min(maxPolar, phi));
      spherical.radius = Math.max(minDist, Math.min(maxDist, radius));
    },
    setPolarLimits(min, max) { minPolar = min; maxPolar = max; },
    setPanLimits(minY, maxY) { panMin.y = minY; panMax.y = maxY; },
    getSpherical() { return { theta: spherical.theta, phi: spherical.phi, radius: spherical.radius }; },
    setDistances(min, max) { minDist = min; maxDist = max; },
    set enabled(v) { enabled = !!v; },
    get enabled() { return enabled; },
    consumeUserInterrupt() { const v = userInterrupted; userInterrupted = false; return v; },
    dispose() {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onCtx);
    },
  };
}
