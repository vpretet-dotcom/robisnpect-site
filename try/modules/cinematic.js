/** Cinematic camera — tip-follow probe shot + C-scan top view. */
export function createCinematic(orbit, getFocus, getPartCenter) {
  const shots = [
    { name: 'orbit', dur: 6.5, theta0: 0.55, theta1: 1.55, phi: 0.88, radius: 1.15, mode: 'cell' },
    { name: 'probe', dur: 5.5, theta0: 0.85, theta1: 1.25, phi: 1.0, radius: 0.48, mode: 'tip' },
    { name: 'track', dur: 5.5, theta0: 0.7, theta1: 1.3, phi: 1.0, radius: 0.48, mode: 'tip' },
    { name: 'cscan', dur: 5.0, theta0: 0.2, theta1: 0.5, phi: 0.45, radius: 0.85, mode: 'part' },
  ];
  let active = false;
  let shotIdx = 0;
  let t = 0;

  function easeInOut(x) {
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }

  function start() {
    active = true;
    shotIdx = 0;
    t = 0;
    orbit.enabled = false;
  }
  function stop() {
    active = false;
    orbit.enabled = true;
  }
  function toggle() {
    if (active) stop();
    else start();
    return active;
  }

  function update(dt) {
    if (!active) return;
    if (orbit.consumeUserInterrupt && orbit.consumeUserInterrupt()) {
      stop();
      return;
    }
    const shot = shots[shotIdx];
    t += dt;
    const u = Math.min(1, t / shot.dur);
    const e = easeInOut(u);
    const theta = shot.theta0 + (shot.theta1 - shot.theta0) * e;
    let phi = shot.phi;
    let radius = shot.radius;

    const tip = getFocus() || { x: 0.2, y: 0.12, z: 0 };
    const part = (getPartCenter && getPartCenter()) || { x: 0.26, y: 0.05, z: 0 };

    if (shot.mode === 'tip') {
      orbit.setTarget(tip.x, tip.y + 0.01, tip.z);
      if (shot.name === 'probe') {
        radius = 0.42 + 0.08 * Math.sin(e * Math.PI);
        phi = 1.02;
        orbit.setTarget(tip.x * 0.7 + part.x * 0.3, tip.y + 0.02, tip.z);
      } else {
        radius = 0.55 + 0.08 * Math.sin(e * Math.PI);
        phi = 1.0;
      }
    } else if (shot.mode === 'part') {
      orbit.setTarget(part.x + 0.02, part.y + 0.015, part.z);
      phi = 0.36 + 0.08 * e;
      radius = 1.05 + 0.12 * (1 - e);
    } else {
      const portrait = typeof window !== 'undefined' && window.matchMedia('(max-width:767px)').matches;
      if (portrait) {
        orbit.setTarget(0.28, 0.14, 0);
        radius = 1.35 + 0.06 * Math.sin(e * Math.PI);
        phi = 0.95;
      } else {
        orbit.setTarget(0.30, 0.16, 0);
        radius = 1.35 + 0.08 * Math.sin(e * Math.PI);
        phi = 0.95;
      }
    }

    orbit.setSpherical(theta, phi, radius);
    orbit.update();
    if (u >= 1) {
      shotIdx = (shotIdx + 1) % shots.length;
      t = 0;
    }
  }

  return {
    get active() { return active; },
    start, stop, toggle, update,
    /** Force a named shot framing immediately (for verification). */
    frame(name) {
      const tip = getFocus() || { x: 0.2, y: 0.12, z: 0 };
      const part = (getPartCenter && getPartCenter()) || { x: 0.26, y: 0.05, z: 0 };
      const portrait = typeof window !== 'undefined' && window.matchMedia('(max-width:767px)').matches;
      if (name === 'probe') {
        /* tip + ~250 mm of part + wrist — mobile stays wider to avoid crop */
        orbit.setDistances(0.22, 4.5);
        orbit.setTarget(tip.x * 0.65 + part.x * 0.35, tip.y + 0.025, tip.z);
        orbit.setSpherical(1.0, portrait ? 0.92 : 1.0, portrait ? 0.85 : 0.45);
      } else if (name === 'top' || name === 'cscan') {
        orbit.setDistances(0.35, 4.5);
        orbit.setTarget(part.x + 0.02, part.y + 0.015, part.z);
        orbit.setSpherical(0.22, portrait ? 0.48 : 0.42, portrait ? 1.55 : 1.2);
      } else {
        orbit.setDistances(0.35, 5.0);
        if (portrait) {
          orbit.setTarget(0.28, 0.14, 0);
          orbit.setSpherical(0.95, 1.05, 1.45);
        } else {
          orbit.setTarget(0.28, 0.16, 0);
          orbit.setSpherical(0.78, 0.90, 1.45);
        }
      }
      orbit.update();
    },
  };
}
