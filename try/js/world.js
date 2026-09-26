import * as THREE from 'three';
import { createPanel, P, fromMetric } from './panel.js';
import { computeTrajectory, createPathVisuals, discoveryPoints } from './trajectory.js';
import { createArm, HOME } from './arm.js';
import { createCoverage } from './cscan.js';
import { FX, makeGlowTexture } from './fx.js';
import { smoothstep, easeInOutCubic, lerp, invLerp } from './util.js';

export const TIMING = {
  scan: 19,
  a3: { approach0: 0.55, approach1: 2.35, descend1: 2.95, lift: 0.5 },
  a4: { retract: 2.1 },
};

export function createWorld(stage, tier) {
  const { scene, renderer } = stage;
  const glow = makeGlowTexture();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const panel = createPanel({ fieldW: tier.field, fieldH: Math.round((tier.field * P.LZ) / P.W0), anisotropy: maxAniso });
  scene.add(panel.group);

  const traj = computeTrajectory();
  const discovery = discoveryPoints(traj, panel.indications);
  const path = createPathVisuals(traj, glow);
  scene.add(path.group);

  const arm = createArm();
  arm.root.position.set(0, 0.5, -1.4);
  arm.root.rotation.y = -Math.PI / 2;
  scene.add(arm.root);
  scene.updateMatrixWorld(true);

  const coverage = createCoverage(renderer, traj, { width: tier.cover });
  panel.uniforms.uCover.value = coverage.texture;

  // Leader lines + anchors for the act-4 indication markers.
  const leaderMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xe8c547).convertSRGBToLinear().multiplyScalar(2.4),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const markers = panel.indications.map((ind) => {
    const h = 0.13;
    const g = new THREE.CylinderGeometry(0.0009, 0.0009, 1, 6, 1, true);
    g.translate(0, 0.5, 0);
    const m = new THREE.Mesh(g, leaderMat);
    m.position.copy(ind.pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ind.normal);
    m.scale.set(1, 0.0001, 1);
    m.renderOrder = 3;
    scene.add(m);
    const anchor = ind.pos.clone().addScaledVector(ind.normal, h);
    return { ind, mesh: m, anchor, h };
  });

  // Scan timing: arc length -> time with speed ramps (slow first pass, slow over indications).
  const n = traj.samples.length;
  const tCum = new Float32Array(n);
  const pass0End = traj.passInfo[0].s1;
  for (let i = 1; i < n; i++) {
    const a = traj.samples[i - 1];
    const b = traj.samples[i];
    const ds = b.s - a.s;
    let f = 1;
    f *= 0.45 + 0.55 * smoothstep(0, pass0End * 0.9, b.s);
    for (const ind of panel.indications) {
      const d = Math.hypot(b.X - ind.X, b.Y - ind.Y);
      f *= 1 - 0.6 * (1 - smoothstep(0.025, 0.1, d));
    }
    if (b.kind === 'lift') f *= 1.2;
    if (b.kind === 'turn') f *= 0.8;
    tCum[i] = tCum[i - 1] + ds / f;
  }
  const scale = TIMING.scan / tCum[n - 1];
  for (let i = 0; i < n; i++) tCum[i] *= scale;

  function sAtTime(tau) {
    if (tau <= 0) return 0;
    if (tau >= TIMING.scan) return traj.total;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tCum[mid] <= tau) lo = mid;
      else hi = mid;
    }
    const k = (tau - tCum[lo]) / (tCum[hi] - tCum[lo] || 1);
    return lerp(traj.samples[lo].s, traj.samples[hi].s, k);
  }

  // Key poses.
  const first = traj.samples[0];
  const last = traj.samples[n - 1];
  const prePoint = first.p.clone().addScaledVector(first.n, 0.09);
  const endPoint = last.p.clone().addScaledVector(last.n, 0.09);
  const tmpA = new THREE.Vector3();
  const qPre = arm.solve(prePoint, tmpA.copy(first.n).negate(), new Array(6));
  const qEnd = arm.solve(endPoint, tmpA.copy(last.n).negate(), new Array(6));
  const q = new Array(6);
  const st = {};
  const pTmp = new THREE.Vector3();

  const lerpQ = (a, b, k) => {
    for (let i = 0; i < 6; i++) q[i] = lerp(a[i], b[i], k);
    return q;
  };

  /** Robot state for act 3 (scan) at time t. */
  function poseScan(t) {
    const A = TIMING.a3;
    const scan0 = A.descend1;
    const scan1 = scan0 + TIMING.scan;
    if (t < A.approach0) return { q: HOME, contact: false, s: 0 };
    if (t < A.approach1) return { q: lerpQ(HOME, qPre, easeInOutCubic(invLerp(A.approach0, A.approach1, t))), contact: false, s: 0 };
    if (t < scan0) {
      const k = easeInOutCubic(invLerp(A.approach1, scan0, t));
      pTmp.copy(prePoint).lerp(first.p, k);
      arm.solve(pTmp, tmpA.copy(first.n).negate(), q);
      return { q, contact: k > 0.98, s: 0, X: first.X, Y: first.Y };
    }
    if (t < scan1) {
      const s = sAtTime(t - scan0);
      traj.at(s, st);
      arm.solve(st.p, tmpA.copy(st.n).negate(), q);
      return { q, contact: st.contact, s, X: st.X, Y: st.Y };
    }
    const k = easeInOutCubic(invLerp(scan1, scan1 + A.lift, t));
    pTmp.copy(last.p).lerp(endPoint, k);
    arm.solve(pTmp, tmpA.copy(last.n).negate(), q);
    return { q, contact: false, s: traj.total, X: last.X, Y: last.Y };
  }

  function poseResult(t) {
    const k = easeInOutCubic(invLerp(0, TIMING.a4.retract, t));
    return { q: lerpQ(qEnd, HOME, k), contact: false, s: traj.total };
  }

  const scanDuration = TIMING.a3.descend1 + TIMING.scan + TIMING.a3.lift + 0.35;

  return {
    panel,
    traj,
    path,
    arm,
    coverage,
    markers,
    discovery,
    glow,
    poseScan,
    poseResult,
    scanDuration,
    FX,
    probeWorld(out = new THREE.Vector3()) {
      return arm.tipWorld(out);
    },
    fieldAt(X, Y) {
      const [s, t] = fromMetric(X, Y);
      return panel.field.sample(s, t);
    },
  };
}
