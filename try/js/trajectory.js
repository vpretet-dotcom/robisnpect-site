import * as THREE from 'three';
import { P, surfacePoint, surfaceNormal, surfaceTangentS, fromMetric, holeHalfWidthAt } from './panel.js';
import { GOLD_LIN } from './fx.js';

/*
 * Raster trajectory computed from the panel surface:
 *  - passes follow the arc (curvature), indexed along the length,
 *  - U-turns stay on the part, inside an edge margin,
 *  - passes that cross the window are split and the probe lifts over it,
 *  - the probe axis stays on the surface normal at every sample.
 */
export const SCAN = {
  edge: 0.034,
  holeGrow: 0.03,
  passes: 11,
  swath: 0.088,
  lift: 0.06,
  step: 0.005,
};

export function computeTrajectory() {
  const samples = [];
  const hw = P.W0 / 2;
  const hh = P.LZ / 2;
  const Y0 = -hh + SCAN.edge;
  const Y1 = hh - SCAN.edge;
  const dY = (Y1 - Y0) / (SCAN.passes - 1);
  const rTurn = dY / 2;
  const Xa = -hw + SCAN.edge + rTurn;
  const Xb = hw - SCAN.edge - rTurn;
  let L = 0;
  let last = null;

  const push = (p, n, X, Y, contact, pass, kind) => {
    if (last) {
      const d = p.distanceTo(last.p);
      if (d < 1e-6) return;
      L += d;
    }
    last = { p: p.clone(), n: n.clone(), X, Y, contact, pass, kind, s: L };
    samples.push(last);
  };
  const surf = (X, Y) => {
    const [s, t] = fromMetric(X, Y);
    return { p: surfacePoint(s, t), n: surfaceNormal(s, t) };
  };
  const line = (x0, x1, Y, pass) => {
    const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / SCAN.step));
    for (let i = 0; i <= n; i++) {
      const X = x0 + ((x1 - x0) * i) / n;
      const q = surf(X, Y);
      push(q.p, q.n, X, Y, true, pass, 'pass');
    }
  };
  const lift = (x0, x1, Y, pass) => {
    const a = surf(x0, Y);
    const b = surf(x1, Y);
    const h = SCAN.lift * 1.35;
    const P0 = a.p;
    const P1 = a.p.clone().addScaledVector(a.n, h);
    const P2 = b.p.clone().addScaledVector(b.n, h);
    const P3 = b.p;
    const curve = new THREE.CubicBezierCurve3(P0, P1, P2, P3);
    const n = 44;
    const nn = new THREE.Vector3();
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const p = curve.getPoint(u);
      nn.copy(a.n).lerp(b.n, u).normalize();
      push(p, nn, x0 + (x1 - x0) * u, Y, false, pass, 'lift');
    }
  };
  const uturn = (xEnd, Y, dir, pass) => {
    const n = 26;
    for (let i = 1; i < n; i++) {
      const phi = -Math.PI / 2 + (Math.PI * i) / n;
      const X = xEnd + dir * rTurn * Math.cos(phi);
      const Yp = Y + dY / 2 + rTurn * Math.sin(phi);
      const q = surf(X, Yp);
      push(q.p, q.n, X, Yp, true, pass, 'turn');
    }
  };

  const passInfo = [];
  for (let k = 0; k < SCAN.passes; k++) {
    const Y = Y0 + k * dY;
    const dir = k % 2 === 0 ? 1 : -1;
    const xStart = dir > 0 ? Xa : Xb;
    const xEnd = dir > 0 ? Xb : Xa;
    const hwHole = holeHalfWidthAt(Y, SCAN.holeGrow);
    const sStart = L;
    if (hwHole > 0) {
      line(xStart, -dir * hwHole, Y, k);
      lift(-dir * hwHole, dir * hwHole, Y, k);
      line(dir * hwHole, xEnd, Y, k);
    } else {
      line(xStart, xEnd, Y, k);
    }
    passInfo.push({ Y, dir, s0: sStart, s1: L, split: hwHole > 0 });
    if (k < SCAN.passes - 1) uturn(xEnd, Y, dir, k);
  }

  // Tangents and in-surface binormals for ribbons.
  const tmp = new THREE.Vector3();
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(i - 1, 0)].p;
    const b = samples[Math.min(i + 1, samples.length - 1)].p;
    const T = new THREE.Vector3().subVectors(b, a).normalize();
    const smp = samples[i];
    smp.t = T;
    if (smp.kind === 'lift') {
      const pi = passInfo[smp.pass];
      const [s, t] = fromMetric(smp.X, smp.Y);
      surfaceTangentS(s, t, tmp).multiplyScalar(pi.dir);
      smp.b = new THREE.Vector3().crossVectors(tmp, smp.n).normalize();
    } else {
      smp.b = new THREE.Vector3().crossVectors(T, smp.n).normalize();
    }
  }

  const total = L;

  function indexAt(s) {
    let lo = 0;
    let hi = samples.length - 1;
    if (s <= 0) return 0;
    if (s >= total) return samples.length - 2;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].s <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Interpolated state at arc length s. */
  function at(s, out = {}) {
    const i = indexAt(s);
    const a = samples[i];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    const span = b.s - a.s || 1;
    const k = THREE.MathUtils.clamp((s - a.s) / span, 0, 1);
    out.p = (out.p || new THREE.Vector3()).copy(a.p).lerp(b.p, k);
    out.n = (out.n || new THREE.Vector3()).copy(a.n).lerp(b.n, k).normalize();
    out.t = (out.t || new THREE.Vector3()).copy(a.t).lerp(b.t, k).normalize();
    out.X = a.X + (b.X - a.X) * k;
    out.Y = a.Y + (b.Y - a.Y) * k;
    out.contact = a.contact && b.contact;
    out.pass = a.pass;
    return out;
  }

  return { samples, total, at, passInfo, dY, rTurn };
}

/** Arc length at which the probe first passes over each indication. */
export function discoveryPoints(traj, indications, radius = 0.028) {
  return indications.map((ind) => {
    for (const smp of traj.samples) {
      if (!smp.contact) continue;
      if (Math.hypot(smp.X - ind.X, smp.Y - ind.Y) < radius) return smp.s;
    }
    let best = Infinity;
    let bestS = traj.total;
    for (const smp of traj.samples) {
      const d = Math.hypot(smp.X - ind.X, smp.Y - ind.Y);
      if (d < best) {
        best = d;
        bestS = smp.s;
      }
    }
    return bestS;
  });
}

export function createPathVisuals(traj, glowTexture) {
  const group = new THREE.Group();
  group.name = 'trajectory';
  const n = traj.samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const aS = new Float32Array(n * 2);
  const aC = new Float32Array(n * 2);
  const aSide = new Float32Array(n * 2);
  const w = 0.0034;
  const lift = 0.0028;
  for (let i = 0; i < n; i++) {
    const smp = traj.samples[i];
    const off = smp.contact ? lift : 0;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const o = (i * 2 + k) * 3;
      pos[o] = smp.p.x + smp.n.x * off + smp.b.x * side * w;
      pos[o + 1] = smp.p.y + smp.n.y * off + smp.b.y * side * w;
      pos[o + 2] = smp.p.z + smp.n.z * off + smp.b.z * side * w;
      aS[i * 2 + k] = smp.s;
      aC[i * 2 + k] = smp.contact ? 1 : 0;
      aSide[i * 2 + k] = side;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  g.setAttribute('aContact', new THREE.BufferAttribute(aC, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  g.setIndex(idx);

  const uniforms = {
    uDraw: { value: 0 },
    uProbeS: { value: -1 },
    uAct3: { value: 0 },
    uFade: { value: 1 },
    uTime: { value: 0 },
    uColor: { value: GOLD_LIN.clone() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aS; attribute float aContact; attribute float aSide;
      varying float vS; varying float vC; varying float vSide;
      void main() {
        vS = aS; vC = aContact; vSide = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDraw; uniform float uProbeS; uniform float uAct3; uniform float uFade; uniform float uTime; uniform vec3 uColor;
      varying float vS; varying float vC; varying float vSide;
      void main() {
        if (vS > uDraw) discard;
        float core = 1.0 - smoothstep(0.3, 1.0, abs(vSide));
        float head = exp(-(uDraw - vS) * 7.0);
        float dash = mix(step(0.42, fract(vS * 24.0 - uTime * 1.2)), 1.0, vC);
        float ahead = smoothstep(uProbeS - 0.12, uProbeS + 0.04, vS);
        float vis = mix(1.0, ahead, uAct3);
        float a = core * dash * vis * uFade;
        if (a < 0.002) discard;
        vec3 col = uColor * (1.6 + 6.0 * head * (1.0 - uAct3)) * mix(1.0, 0.75, 1.0 - vC);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ribbon = new THREE.Mesh(g, mat);
  ribbon.renderOrder = 2;
  ribbon.frustumCulled = false;
  group.add(ribbon);

  // Normal ticks: probe orientation along the path.
  const ticks = [];
  let nextS = 0;
  for (const smp of traj.samples) {
    if (smp.kind !== 'pass') continue;
    if (smp.s >= nextS) {
      ticks.push(smp);
      nextS = smp.s + 0.075;
    }
  }
  const tickGeo = new THREE.CylinderGeometry(0.0011, 0.0011, 1, 5, 1, true);
  tickGeo.translate(0, 0.5, 0);
  const tickS = new Float32Array(ticks.length);
  const inst = new THREE.InstancedMesh(tickGeo, null, ticks.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  ticks.forEach((smp, i) => {
    q.setFromUnitVectors(up, smp.n);
    m4.compose(smp.p.clone().addScaledVector(smp.n, 0.003), q, new THREE.Vector3(1, 0.034, 1));
    inst.setMatrixAt(i, m4);
    tickS[i] = smp.s;
  });
  tickGeo.setAttribute('aS', new THREE.InstancedBufferAttribute(tickS, 1));
  inst.material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aS;
      uniform float uDraw; uniform float uProbeS; uniform float uAct3;
      varying float vK; varying float vY;
      void main() {
        float grow = smoothstep(aS, aS + 0.35, uDraw);
        float gone = uAct3 * (1.0 - smoothstep(uProbeS - 0.1, uProbeS + 0.02, aS));
        vK = grow * (1.0 - gone);
        vY = position.y;
        vec3 p = position; p.y *= max(vK, 0.0001);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uFade;
      varying float vK; varying float vY;
      void main() {
        if (vK < 0.01) discard;
        float a = vK * uFade * (1.0 - vY * 0.6);
        gl_FragColor = vec4(uColor * 1.6, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  inst.frustumCulled = false;
  inst.renderOrder = 2;
  group.add(inst);

  // Glowing draw head.
  const head = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color(1.0, 0.78, 0.3).multiplyScalar(2.2),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  head.scale.setScalar(0.07);
  head.renderOrder = 3;
  head.visible = false;
  group.add(head);

  return { group, uniforms, head, tickCount: ticks.length };
}
