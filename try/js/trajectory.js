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

/*
 * Zone trajectory on any parametric surface.
 * `surface.point(s, t, out)` / `normal(s, t, out)` use parameters in 0..1.
 * Raster passes run along `surface.along` ('s' or 't'), inset by an edge
 * margin, with the probe on the surface normal. `surface.blocked(s, t)`
 * lifts the probe over a hole. A weld (`kind: 'weld'`) is a handful of
 * passes parallel to the bead instead of a full-surface raster.
 * Returns `{ tooSmall: true }` when the zone cannot hold one pass.
 * The scripted panel path above is untouched.
 */
const ZONE_MIN_TRAVEL = 0.05;
const ZONE_MIN_CROSS = 0.012;

function smoothPathNormals(samples) {
  const raw = samples.map((s) => s.n.clone());
  const acc = new THREE.Vector3();
  for (let i = 0; i < samples.length; i++) {
    acc.set(0, 0, 0);
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= samples.length) continue;
      if (raw[j].dot(raw[i]) < 0.2) continue;
      const w = k === 0 ? 3 : Math.abs(k) === 1 ? 2 : 1;
      acc.addScaledVector(raw[j], w);
    }
    if (acc.lengthSq() > 1e-10) samples[i].n.copy(acc).normalize();
  }
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].n.dot(samples[i - 1].n) < 0) samples[i].n.negate();
  }
}

function finishZoneSamples(samples) {
  smoothPathNormals(samples);
  const tmp = new THREE.Vector3();
  let prevB = new THREE.Vector3(1, 0, 0);
  let prevT = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(i - 1, 0)].p;
    const b = samples[Math.min(i + 1, samples.length - 1)].p;
    const smp = samples[i];
    const T = smp.tHint ? tmp.copy(smp.tHint) : tmp.subVectors(b, a);
    if (T.lengthSq() < 1e-12) T.copy(prevT);
    else T.normalize();
    T.addScaledVector(smp.n, -T.dot(smp.n));
    if (T.lengthSq() < 1e-10) T.copy(prevT);
    else T.normalize();
    if (i > 0 && T.dot(prevT) < 0) T.negate();
    smp.t = T.clone();
    prevT = smp.t;
    const side = new THREE.Vector3().crossVectors(smp.t, smp.n);
    if (side.lengthSq() < 1e-8) smp.b = prevB.clone();
    else {
      smp.b = side.normalize();
      prevB = smp.b;
    }
  }
  const total = samples.length ? samples[samples.length - 1].s : 0;
  function indexAt(s) {
    let lo = 0;
    let hi = samples.length - 1;
    if (s <= 0) return 0;
    if (s >= total) return Math.max(0, samples.length - 2);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].s <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  function at(s, out = {}) {
    const i = indexAt(s);
    const a = samples[i];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    const span = b.s - a.s || 1;
    const k = THREE.MathUtils.clamp((s - a.s) / span, 0, 1);
    out.p = (out.p || new THREE.Vector3()).copy(a.p).lerp(b.p, k);
    out.n = (out.n || new THREE.Vector3()).copy(a.n).lerp(b.n, k).normalize();
    out.t = (out.t || new THREE.Vector3()).copy(a.t).lerp(b.t, k).normalize();
    out.u = a.u + (b.u - a.u) * k;
    out.v = a.v + (b.v - a.v) * k;
    out.X = a.X + (b.X - a.X) * k;
    out.Y = a.Y + (b.Y - a.Y) * k;
    out.contact = a.contact && b.contact;
    out.pass = a.pass;
    if (a.q && b.q) {
      const qq = out.q || (out.q = [0, 0, 0, 0, 0, 0]);
      for (let j = 0; j < 6; j++) qq[j] = a.q[j] + (b.q[j] - a.q[j]) * k;
    }
    return out;
  }
  let contactLen = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].contact && samples[i - 1].contact) contactLen += samples[i].s - samples[i - 1].s;
  }
  return { samples, total, at, contactLen, tooSmall: false };
}

function makeZoneBuilder(surface) {
  const samples = [];
  let L = 0;
  let last = null;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
    const push = (s, t, contact, pass, kind, pos, nrm, tHint) => {
    const pp = (pos || surface.point(s, t, p)).clone();
    const nn = (nrm || surface.normal(s, t, n)).clone().normalize();
    if (last) {
      const d = pp.distanceTo(last.p);
      if (d < 1e-6) return;
      L += d;
    }
    const Ls = surface.lengthS || 1;
    const Lt = surface.lengthT || 1;
    last = {
      p: pp,
      n: nn,
      u: s,
      v: t,
      X: (s - 0.5) * Ls,
      Y: (t - 0.5) * Lt,
      contact,
      pass,
      kind,
      s: L,
    };
    if (tHint && tHint.lengthSq() > 1e-8) last.tHint = tHint.clone().normalize();
    samples.push(last);
  };
  const line = (s0, s1, t0, t1, pass) => {
    const a = surface.point(s0, t0, new THREE.Vector3());
    const b = surface.point(s1, t1, new THREE.Vector3());
    const dist = a.distanceTo(b);
    const steps = Math.max(2, Math.ceil(dist / (surface.step || 0.008)));
    const ds = s1 - s0;
    const dt = t1 - t0;
    const mag = Math.hypot(ds, dt) || 1;
    const us = ds / mag;
    const ut = dt / mag;
    const hint = new THREE.Vector3();
    const hintB = new THREE.Vector3();
    const eps = 0.012;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const s = s0 + (s1 - s0) * k;
      const t = t0 + (t1 - t0) * k;
      let contact = true;
      let kind = 'pass';
      surface.point(s, t, p);
      surface.normal(s, t, n);
      if (surface.blocked?.(s, t)) {
        p.addScaledVector(n, surface.lift || 0.05);
        contact = false;
        kind = 'lift';
      }
      surface.point(Math.min(1, Math.max(0, s + eps * us)), Math.min(1, Math.max(0, t + eps * ut)), hint);
      surface.point(Math.min(1, Math.max(0, s - eps * us)), Math.min(1, Math.max(0, t - eps * ut)), hintB);
      hint.sub(hintB);
      push(s, t, contact, pass, kind, p, n, hint);
    }
  };
  const lift = (s0, s1, t0, t1, pass) => {
    const aP = surface.point(s0, t0, new THREE.Vector3());
    const bP = surface.point(s1, t1, new THREE.Vector3());
    const aN = surface.normal(s0, t0, new THREE.Vector3());
    const bN = surface.normal(s1, t1, new THREE.Vector3());
    const h = (surface.lift || 0.05) * 1.35;
    const curve = new THREE.CubicBezierCurve3(
      aP,
      aP.clone().addScaledVector(aN, h),
      bP.clone().addScaledVector(bN, h),
      bP
    );
    const steps = 28;
    const nn = new THREE.Vector3();
    for (let i = 1; i < steps; i++) {
      const u = i / steps;
      const pos = curve.getPoint(u);
      nn.copy(aN).lerp(bN, u).normalize();
      push(s0 + (s1 - s0) * u, t0 + (t1 - t0) * u, false, pass, 'lift', pos, nn);
    }
  };
  const passAlong = (sA, sB, tA, tB, pass) => {
    const alongS = Math.abs(sB - sA) >= Math.abs(tB - tA);
    const steps = 40;
    const flags = [];
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const s = sA + (sB - sA) * k;
      const t = tA + (tB - tA) * k;
      flags.push({ s, t, hit: !!(surface.blocked && surface.blocked(s, t)) });
    }
    let i = 0;
    while (i <= steps) {
      const hit = flags[i].hit;
      let j = i;
      while (j <= steps && flags[j].hit === hit) j++;
      const end = Math.min(j, steps);
      const a = flags[i];
      const b = flags[end];
      if (hit) lift(a.s, b.s, a.t, b.t, pass);
      else line(a.s, b.s, a.t, b.t, pass);
      i = j;
    }
    void alongS;
  };
  /*
   * On-part U-turn between passes, a semicircle of radius pitch / 2 as in
   * the scripted path. The shoe roll stays on the pass axis through the
   * turn: the next pass runs back along the same line, so the wrist does
   * not wind by π at every reversal.
   */
  const uturn = (aEnd, cA, cB, dir, alongS, pass) => {
    const aScale = alongS ? surface.lengthS || 1 : surface.lengthT || 1;
    const cScale = alongS ? surface.lengthT || 1 : surface.lengthS || 1;
    const r = (Math.abs(cB - cA) * cScale) / 2;
    const cMid = (cA + cB) / 2;
    const sign = Math.sign(cB - cA) || 1;
    const steps = Math.max(8, Math.ceil((Math.PI * r) / 0.005));
    const hint = new THREE.Vector3();
    const back = new THREE.Vector3();
    const eps = 0.012;
    for (let i = 1; i < steps; i++) {
      const phi = -Math.PI / 2 + (Math.PI * i) / steps;
      const a = Math.min(1, Math.max(0, aEnd + (dir * r * Math.cos(phi)) / aScale));
      const c = Math.min(1, Math.max(0, cMid + (sign * r * Math.sin(phi)) / cScale));
      const s = alongS ? a : c;
      const t = alongS ? c : a;
      surface.point(s, t, p);
      surface.normal(s, t, n);
      let contact = true;
      if (surface.blocked?.(s, t)) {
        p.addScaledVector(n, surface.lift || 0.05);
        contact = false;
      }
      const ds = alongS ? eps : 0;
      const dt = alongS ? 0 : eps;
      surface.point(Math.min(1, s + ds), Math.min(1, t + dt), hint);
      surface.point(Math.max(0, s - ds), Math.max(0, t - dt), back);
      hint.sub(back);
      push(s, t, contact, pass, 'turn', p, n, hint);
    }
  };
  return { samples, push, line, lift, passAlong, uturn };
}

/* Passes are at most this fraction of the probe footprint apart, so bands overlap. */
export const PITCH_OF_SWATH = 0.85;

function passCount(crossSpan, swath) {
  if (crossSpan <= PITCH_OF_SWATH * swath) return 1;
  return Math.min(40, Math.ceil(crossSpan / (PITCH_OF_SWATH * swath) - 1e-9) + 1);
}

/*
 * Serpentine raster over `crosses` (parameter values) between a0 and a1.
 * a0 / a1 are the zone ends. A U-turn's apex stops a quarter of `edge`
 * short of them, so the turn stays inside the zone and the footprint
 * still reaches its end.
 */
function buildRaster(surface, alongS, a0, a1, crosses) {
  const aScale = alongS ? surface.lengthS || 1 : surface.lengthT || 1;
  const cScale = alongS ? surface.lengthT || 1 : surface.lengthS || 1;
  const pitch = crosses.length > 1 ? Math.abs(crosses[1] - crosses[0]) * cScale : 0;
  const endGap = (surface.edge ?? 0.02) * 0.25 + pitch / 2;
  const lo = a0 + endGap / aScale;
  const hi = a1 - endGap / aScale;
  if (!(hi - lo > ZONE_MIN_TRAVEL / aScale)) return null;
  const bld = makeZoneBuilder(surface);
  const passInfo = [];
  for (let k = 0; k < crosses.length; k++) {
    const c = crosses[k];
    const fwd = k % 2 === 0;
    const from = fwd ? lo : hi;
    const to = fwd ? hi : lo;
    const sStart = bld.samples.length ? bld.samples[bld.samples.length - 1].s : 0;
    if (alongS) bld.passAlong(from, to, c, c, k);
    else bld.passAlong(c, c, from, to, k);
    passInfo.push({ pass: k, s0: sStart, s1: bld.samples.length ? bld.samples[bld.samples.length - 1].s : sStart, dir: fwd ? 1 : -1 });
    if (k < crosses.length - 1) bld.uturn(to, c, crosses[k + 1], fwd ? 1 : -1, alongS, k);
  }
  if (bld.samples.length < 2) return null;
  const done = finishZoneSamples(bld.samples);
  if (done.contactLen < ZONE_MIN_TRAVEL * 0.8) return null;
  done.passInfo = passInfo;
  done.passes = crosses.length;
  done.pitch = pitch;
  done.swath = surface.swath ?? 0.05;
  return done;
}

export function computeZoneTrajectory(surface, zone) {
  if (!zone || !surface) return { tooSmall: true };
  if (surface.kind === 'weld') return computeWeldTrajectory(surface, zone);
  return computeRasterTrajectory(surface, zone);
}

function computeRasterTrajectory(surface, zone) {
  const alongS = surface.along !== 't';
  const edge = surface.edge ?? 0.022;
  const Ls = surface.lengthS || 1;
  const Lt = surface.lengthT || 1;
  const s0 = zone.s0 + edge / Ls;
  const s1 = zone.s1 - edge / Ls;
  const t0 = zone.t0 + edge / Lt;
  const t1 = zone.t1 - edge / Lt;
  if (!(s1 > s0) || !(t1 > t0)) return { tooSmall: true };
  const travelLen = (alongS ? s1 - s0 : t1 - t0) * (alongS ? Ls : Lt);
  const crossLen = (alongS ? t1 - t0 : s1 - s0) * (alongS ? Lt : Ls);
  if (travelLen < ZONE_MIN_TRAVEL || crossLen < ZONE_MIN_CROSS) return { tooSmall: true };

  const swath = surface.swath ?? 0.05;
  const nPass = passCount(crossLen, swath);
  const cross0 = alongS ? t0 : s0;
  const cross1 = alongS ? t1 : s1;
  const crosses = [];
  for (let k = 0; k < nPass; k++) crosses.push(nPass === 1 ? (cross0 + cross1) / 2 : cross0 + ((cross1 - cross0) * k) / (nPass - 1));
  const done = buildRaster(surface, alongS, alongS ? zone.s0 : zone.t0, alongS ? zone.s1 : zone.t1, crosses);
  return done || { tooSmall: true };
}

function computeWeldTrajectory(surface, zone) {
  const edge = surface.edge ?? 0.018;
  const Lt = surface.lengthT || 1;
  const Ls = surface.lengthS || 1;
  const t0 = zone.t0 + edge / Lt;
  const t1 = zone.t1 - edge / Lt;
  if (!(t1 > t0) || (t1 - t0) * Lt < ZONE_MIN_TRAVEL) return { tooSmall: true };
  const offsets = surface.weldOffsets || [-0.032, -0.016, 0, 0.016, 0.032];
  const done = buildRaster(surface, false, zone.t0, zone.t1, offsets.map((o) => 0.5 + o / Ls));
  return done || { tooSmall: true };
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
  if (!ticks.length && traj.samples.length) ticks.push(traj.samples[0]);
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
