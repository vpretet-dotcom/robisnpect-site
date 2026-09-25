/**
 * UR-type 6R analytic IK/FK — port of ros-industrial ur_kinematics (Hawkins).
 * Params (m): d1=0.152, a2=-0.425, a3=-0.395, d4=0.102, d5=0.102, d6=0.100
 * + toolLen along flange +Z to TCP. Robot Z-up; scene Y-up.
 */
export const ARM = {
  d1: 0.152,
  a2: -0.425, /* UR convention: negative */
  a3: -0.395,
  d4: 0.102,
  d5: 0.102,
  d6: 0.100,
  toolLen: 0.200,
  /* small shoe/wedge tilt keeps q5 off wrist singularity when probe is normal-to-surface */
  toolTilt: (8 * Math.PI) / 180,
  get L2() { return Math.abs(this.a2); },
  get L3() { return Math.abs(this.a3); },
};

export const BASE = { x: 0, y: 0, z: 0 };

/* Comfortable elbow-up home — probe roughly down over table workspace */
export const HOME_JOINTS = [-0.405, -1.16, 1.78, -0.62, -0.55, 0.14];

export const JOINT_LIMITS = [
  [-Math.PI, Math.PI],
  [-2.6, 0.2],
  [-0.25, 2.9],
  [-Math.PI, Math.PI],
  [-2.9, 2.9],
  [-Math.PI, Math.PI],
];

export const SCAN_CFG = { shoulder: 0, elbow: 0, wrist: 1 };

const ZERO = 1e-8;
const PI = Math.PI;
function SIGN(x) { return (x > 0) - (x < 0); }

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function wrapAngle(a) {
  while (a > PI) a -= 2 * PI;
  while (a < -PI) a += 2 * PI;
  return a;
}
export function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }

export function applyLimits(q) {
  const out = q.slice();
  let hit = false;
  for (let i = 0; i < 6; i++) {
    const [lo, hi] = JOINT_LIMITS[i];
    if (out[i] < lo) { out[i] = lo; hit = true; }
    if (out[i] > hi) { out[i] = hi; hit = true; }
  }
  return { joints: out, hit };
}

export function jointLimitRatio(q) {
  return q.map((v, i) => {
    const [lo, hi] = JOINT_LIMITS[i];
    const mid = (lo + hi) / 2;
    return Math.abs(v - mid) / Math.max((hi - lo) / 2, 1e-6);
  });
}

export function nearJointLimit(q, marginDeg = 10) {
  const m = (marginDeg * PI) / 180;
  for (let i = 0; i < 6; i++) {
    const [lo, hi] = JOINT_LIMITS[i];
    if (q[i] < lo + m || q[i] > hi - m) return true;
  }
  return false;
}

export function zUpToYUp(p) { return { x: p.x, y: p.z, z: -p.y }; }
export function yUpToZUp(p) { return { x: p.x, y: -p.z, z: p.y }; }
export function zUpVecToYUp(v) { return { x: v.x, y: v.z, z: -v.y }; }
export function yUpVecToZUp(v) { return { x: v.x, y: -v.z, z: v.y }; }

export function norm3(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
export function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross3(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function slerpVec(a, b, t) {
  const na = norm3(a), nb = norm3(b);
  const d = clamp(dot3(na, nb), -1, 1);
  if (d > 0.9995) {
    return norm3({ x: na.x+(nb.x-na.x)*t, y: na.y+(nb.y-na.y)*t, z: na.z+(nb.z-na.z)*t });
  }
  const th = Math.acos(d), s = Math.sin(th);
  const w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s;
  return norm3({ x: na.x*w1+nb.x*w2, y: na.y*w1+nb.y*w2, z: na.z*w1+nb.z*w2 });
}

/** ur_kin::forward — row-major 16 T of flange in Z-up */
export function forwardFlat(q) {
  const { d1, a2, a3, d4, d5, d6 } = ARM;
  const s1 = Math.sin(q[0]), c1 = Math.cos(q[0]);
  const s2 = Math.sin(q[1]), c2 = Math.cos(q[1]);
  const s3 = Math.sin(q[2]), c3 = Math.cos(q[2]);
  const q23 = q[1] + q[2], q234 = q23 + q[3];
  const s5 = Math.sin(q[4]), c5 = Math.cos(q[4]);
  const s6 = Math.sin(q[5]), c6 = Math.cos(q[5]);
  const s23 = Math.sin(q23), c23 = Math.cos(q23);
  const s234 = Math.sin(q234), c234 = Math.cos(q234);
  const T = new Array(16);
  T[0] = c234 * c1 * s5 - c5 * s1;
  T[1] = c6 * (s1 * s5 + c234 * c1 * c5) - s234 * c1 * s6;
  T[2] = -s6 * (s1 * s5 + c234 * c1 * c5) - s234 * c1 * c6;
  T[3] = d6 * c234 * c1 * s5 - a3 * c23 * c1 - a2 * c1 * c2 - d6 * c5 * s1 - d5 * s234 * c1 - d4 * s1;
  T[4] = c1 * c5 + c234 * s1 * s5;
  T[5] = -c6 * (c1 * s5 - c234 * c5 * s1) - s234 * s1 * s6;
  T[6] = s6 * (c1 * s5 - c234 * c5 * s1) - s234 * c6 * s1;
  T[7] = d6 * (c1 * c5 + c234 * s1 * s5) + d4 * c1 - a3 * c23 * s1 - a2 * c2 * s1 - d5 * s234 * s1;
  T[8] = -s234 * s5;
  T[9] = -c234 * s6 - s234 * c5 * c6;
  T[10] = s234 * c5 * s6 - c234 * c6;
  const s4 = Math.sin(q[3]), c4v = Math.cos(q[3]);
  T[11] = d1 + a3 * s23 + a2 * s2 - d5 * (c23 * c4v - s23 * s4) - d6 * s5 * (c23 * s4 + s23 * c4v);
  T[12] = 0; T[13] = 0; T[14] = 0; T[15] = 1;
  return T;
}
function c4(q) { return Math.cos(q[3]); }
function s4(q) { return Math.sin(q[3]); }

/** Cleaner forward matching ur_kin exactly */
export function forward(q) {
  const { d1, a2, a3, d4, d5, d6 } = ARM;
  const s1 = Math.sin(q[0]), c1 = Math.cos(q[0]);
  let q23 = q[1], q234 = q[1];
  const s2 = Math.sin(q[1]), c2 = Math.cos(q[1]);
  const s3 = Math.sin(q[2]), c3 = Math.cos(q[2]);
  q23 += q[2]; q234 += q[2];
  const s4 = Math.sin(q[3]), c4v = Math.cos(q[3]);
  q234 += q[3];
  const s5 = Math.sin(q[4]), c5 = Math.cos(q[4]);
  const s6 = Math.sin(q[5]), c6 = Math.cos(q[5]);
  const s23 = Math.sin(q23), c23 = Math.cos(q23);
  const s234 = Math.sin(q234), c234 = Math.cos(q234);
  return [
    c234*c1*s5 - c5*s1,
    c6*(s1*s5 + c234*c1*c5) - s234*c1*s6,
    -s6*(s1*s5 + c234*c1*c5) - s234*c1*c6,
    d6*c234*c1*s5 - a3*c23*c1 - a2*c1*c2 - d6*c5*s1 - d5*s234*c1 - d4*s1,

    c1*c5 + c234*s1*s5,
    -c6*(c1*s5 - c234*c5*s1) - s234*s1*s6,
    s6*(c1*s5 - c234*c5*s1) - s234*c6*s1,
    d6*(c1*c5 + c234*s1*s5) + d4*c1 - a3*c23*s1 - a2*c2*s1 - d5*s234*s1,

    -s234*s5,
    -c234*s6 - s234*c5*c6,
    s234*c5*s6 - c234*c6,
    d1 + a3*s23 + a2*s2 - d5*(c23*c4v - s23*s4) - d6*s5*(c23*s4 + s23*c4v),

    0, 0, 0, 1,
  ];
}

/** ur_kin::inverse — T row-major 16, returns list of q[6] in (-π,π] */
export function inverse(Tin, q6Des = 0) {
  const { d1, a2, a3, d4, d5, d6 } = ARM;
  /* Remap as in ur_kin.cpp */
  let i = 0;
  const T02 = -Tin[i++]; const T00 = Tin[i++]; const T01 = Tin[i++]; const T03 = -Tin[i++];
  const T12 = -Tin[i++]; const T10 = Tin[i++]; const T11 = Tin[i++]; const T13 = -Tin[i++];
  const T22 = Tin[i++]; const T20 = -Tin[i++]; const T21 = -Tin[i++]; const T23 = Tin[i++];

  const q1 = [0, 0];
  {
    const A = d6 * T12 - T13;
    const B = d6 * T02 - T03;
    const R = A * A + B * B;
    if (Math.abs(A) < ZERO) {
      const div = Math.abs(Math.abs(d4) - Math.abs(B)) < ZERO ? -SIGN(d4) * SIGN(B) : -d4 / B;
      let arcsin = Math.asin(clamp(div, -1, 1));
      if (Math.abs(arcsin) < ZERO) arcsin = 0;
      q1[0] = arcsin < 0 ? arcsin + 2 * PI : arcsin;
      q1[1] = PI - arcsin;
    } else if (Math.abs(B) < ZERO) {
      const div = Math.abs(Math.abs(d4) - Math.abs(A)) < ZERO ? SIGN(d4) * SIGN(A) : d4 / A;
      const arccos = Math.acos(clamp(div, -1, 1));
      q1[0] = arccos;
      q1[1] = 2 * PI - arccos;
    } else if (d4 * d4 > R) {
      return [];
    } else {
      const arccos = Math.acos(d4 / Math.sqrt(R));
      const arctan = Math.atan2(-B, A);
      let pos = arccos + arctan;
      let neg = -arccos + arctan;
      if (Math.abs(pos) < ZERO) pos = 0;
      if (Math.abs(neg) < ZERO) neg = 0;
      q1[0] = pos >= 0 ? pos : 2 * PI + pos;
      q1[1] = neg >= 0 ? neg : 2 * PI + neg;
    }
  }

  const q5 = [[0, 0], [0, 0]];
  for (let ii = 0; ii < 2; ii++) {
    const numer = (T03 * Math.sin(q1[ii]) - T13 * Math.cos(q1[ii]) - d4);
    const div = Math.abs(Math.abs(numer) - Math.abs(d6)) < ZERO
      ? SIGN(numer) * SIGN(d6) : numer / d6;
    const arccos = Math.acos(clamp(div, -1, 1));
    q5[ii][0] = arccos;
    q5[ii][1] = 2 * PI - arccos;
  }

  const sols = [];
  for (let ii = 0; ii < 2; ii++) {
    for (let jj = 0; jj < 2; jj++) {
      const c1 = Math.cos(q1[ii]), s1 = Math.sin(q1[ii]);
      const c5 = Math.cos(q5[ii][jj]), s5 = Math.sin(q5[ii][jj]);
      let q6;
      if (Math.abs(s5) < ZERO) q6 = q6Des;
      else {
        q6 = Math.atan2(SIGN(s5) * -(T01 * s1 - T11 * c1), SIGN(s5) * (T00 * s1 - T10 * c1));
        if (Math.abs(q6) < ZERO) q6 = 0;
        if (q6 < 0) q6 += 2 * PI;
      }

      const c6 = Math.cos(q6), s6 = Math.sin(q6);
      const x04x = -s5 * (T02 * c1 + T12 * s1) - c5 * (s6 * (T01 * c1 + T11 * s1) - c6 * (T00 * c1 + T10 * s1));
      const x04y = c5 * (T20 * c6 - T21 * s6) - T22 * s5;
      const p13x = d5 * (s6 * (T00 * c1 + T10 * s1) + c6 * (T01 * c1 + T11 * s1))
        - d6 * (T02 * c1 + T12 * s1) + T03 * c1 + T13 * s1;
      const p13y = T23 - d1 - d6 * T22 + d5 * (T21 * c6 + T20 * s6);

      let c3 = (p13x * p13x + p13y * p13y - a2 * a2 - a3 * a3) / (2.0 * a2 * a3);
      if (Math.abs(Math.abs(c3) - 1) < ZERO) c3 = SIGN(c3);
      else if (Math.abs(c3) > 1) continue;
      const arccos = Math.acos(c3);
      const q3 = [arccos, 2 * PI - arccos];
      const denom = a2 * a2 + a3 * a3 + 2 * a2 * a3 * c3;
      const s3 = Math.sin(arccos);
      const A = a2 + a3 * c3, B = a3 * s3;
      const q2 = [
        Math.atan2((A * p13y - B * p13x) / denom, (A * p13x + B * p13y) / denom),
        Math.atan2((A * p13y + B * p13x) / denom, (A * p13x - B * p13y) / denom),
      ];
      const q4 = [0, 0];
      for (let k = 0; k < 2; k++) {
        const c23 = Math.cos(q2[k] + q3[k]);
        const s23 = Math.sin(q2[k] + q3[k]);
        q4[k] = Math.atan2(c23 * x04y - s23 * x04x, x04x * c23 + x04y * s23);
      }
      for (let k = 0; k < 2; k++) {
        let qq2 = q2[k], qq3 = q3[k], qq4 = q4[k];
        if (Math.abs(qq2) < ZERO) qq2 = 0; else if (qq2 < 0) qq2 += 2 * PI;
        if (Math.abs(qq4) < ZERO) qq4 = 0; else if (qq4 < 0) qq4 += 2 * PI;
        const q = [q1[ii], qq2, qq3, qq4, q5[ii][jj], q6].map(wrapAngle);
        sols.push({
          joints: q,
          shoulder: ii,
          elbow: k,
          wrist: jj,
        });
      }
    }
  }
  return sols;
}

export function fkYUp(q) {
  const T = forward(q);
  /* T is row-major: R rows [0:3],[4:7],[8:11], p at [3],[7],[11] */
  const flangeZ = { x: T[3], y: T[7], z: T[11] };
  const approachZ = { x: T[2], y: T[6], z: T[10] }; /* column Z = indices 2,6,10 */
  const tcpZ = {
    x: flangeZ.x + approachZ.x * ARM.toolLen,
    y: flangeZ.y + approachZ.y * ARM.toolLen,
    z: flangeZ.z + approachZ.z * ARM.toolLen,
  };
  return {
    tcp: zUpToYUp(tcpZ),
    flange: zUpToYUp(flangeZ),
    approach: zUpVecToYUp(approachZ),
    T,
    joints: q.slice(),
  };
}

export function tcpPoseToFlangeT(tcpY, normalY, twist = 0) {
  /* Contact direction (into surface) in Y-up */
  let contactY = norm3({
    x: -(normalY?.x ?? 0),
    y: -(normalY?.y ?? 1),
    z: -(normalY?.z ?? 0),
  });
  /* Flange approach = contact tilted by toolTilt about a surface tangent (wedge) */
  let refY = { x: 1, y: 0, z: 0 };
  if (Math.abs(dot3(contactY, refY)) > 0.9) refY = { x: 0, y: 0, z: 1 };
  const tangent = norm3(cross3(refY, contactY));
  const tilt = ARM.toolTilt || 0;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  /* Rodrigues: rotate contact around tangent by tilt */
  const approachY = norm3({
    x: contactY.x * ct + cross3(tangent, contactY).x * st + tangent.x * dot3(tangent, contactY) * (1 - ct),
    y: contactY.y * ct + cross3(tangent, contactY).y * st + tangent.y * dot3(tangent, contactY) * (1 - ct),
    z: contactY.z * ct + cross3(tangent, contactY).z * st + tangent.z * dot3(tangent, contactY) * (1 - ct),
  });
  const approachZ = yUpVecToZUp(approachY);
  const tcpZ = yUpToZUp(tcpY);
  const flangeZ = {
    x: tcpZ.x - approachZ.x * ARM.toolLen,
    y: tcpZ.y - approachZ.y * ARM.toolLen,
    z: tcpZ.z - approachZ.z * ARM.toolLen,
  };
  let ref = { x: 0, y: 0, z: 1 };
  if (Math.abs(dot3(approachZ, ref)) > 0.92) ref = { x: 1, y: 0, z: 0 };
  let xAxis = norm3(cross3(ref, approachZ));
  let yAxis = cross3(approachZ, xAxis);
  const c = Math.cos(twist), s = Math.sin(twist);
  const xr = {
    x: xAxis.x * c + yAxis.x * s,
    y: xAxis.y * c + yAxis.y * s,
    z: xAxis.z * c + yAxis.z * s,
  };
  const yr = cross3(approachZ, xr);
  return [
    xr.x, yr.x, approachZ.x, flangeZ.x,
    xr.y, yr.y, approachZ.y, flangeZ.y,
    xr.z, yr.z, approachZ.z, flangeZ.z,
    0, 0, 0, 1,
  ];
}

export function pickSolution(sols, seed, cfg = SCAN_CFG) {
  if (!sols.length) return null;
  const within = sols.filter((s) => {
    for (let i = 0; i < 6; i++) {
      const [lo, hi] = JOINT_LIMITS[i];
      if (s.joints[i] < lo + 1e-3 || s.joints[i] > hi - 1e-3) return false;
    }
    return true;
  });
  let pool = (within.length ? within : sols);
  const pref = pool.filter((s) => s.shoulder === cfg.shoulder && s.elbow === cfg.elbow && s.wrist === cfg.wrist);
  if (pref.length) pool = pref;
  else {
    const e = pool.filter((s) => s.elbow === cfg.elbow && s.shoulder === cfg.shoulder);
    if (e.length) pool = e;
  }
  let best = null, bestScore = Infinity;
  for (const s of pool) {
    let score = 0;
    for (let i = 0; i < 6; i++) score += Math.abs(wrapAngle(s.joints[i] - seed[i]));
    if (nearJointLimit(s.joints, 10)) score += 4;
    const aq5 = Math.abs(s.joints[4]);
    const distSing = Math.min(aq5, Math.abs(aq5 - Math.PI), Math.abs(aq5 + Math.PI));
    if (distSing < 0.45) score += 5;
    else if (distSing < 0.7) score += 1.5;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/**
 * Lock config on first successful solve of a path; thereafter keep branch.
 */
let _lockedCfg = null;
export function lockScanCfg(cfg) { _lockedCfg = cfg ? { ...cfg } : null; }
export function getLockedCfg() { return _lockedCfg; }

export function solveIk(target, normal, seed = HOME_JOINTS, opts = {}) {
  const twist = opts.twist || 0;
  const T = tcpPoseToFlangeT(target, normal, twist);
  const sols = inverse(T, seed[5] >= 0 ? seed[5] : seed[5] + 2 * PI);
  const cfg = opts.cfg || _lockedCfg || SCAN_CFG;
  const pick = pickSolution(sols, seed, cfg);
  const approachDes = norm3({
    x: -(normal?.x ?? 0),
    y: -(normal?.y ?? 1),
    z: -(normal?.z ?? 0),
  });

  if (!pick) {
    return {
      joints: seed.slice(), reachable: false, posErr: 1, angErr: Math.PI,
      angErrFlange: Math.PI, angErrContact: Math.PI,
      wristFlip: true, approach: approachDes, tcp: target, nSols: 0,
    };
  }

  if (opts.lockCfg && !_lockedCfg) _lockedCfg = { shoulder: pick.shoulder, elbow: pick.elbow, wrist: pick.wrist };

  const q = pick.joints.slice();
  const final = fkYUp(q);
  const posErr = Math.hypot(final.tcp.x - target.x, final.tcp.y - target.y, final.tcp.z - target.z);
  /* P4.3 — angErrFlange: flange approach vs tilted commanded pose (toolTilt OK here) */
  const desApZ = { x: T[2], y: T[6], z: T[10] };
  const desApY = zUpVecToYUp(desApZ);
  const angErrFlange = Math.acos(clamp(dot3(final.approach, desApY), -1, 1));
  /* P4.3 — angErrContact: surface ⊥ — contact (−normal) vs flange approach; toolTilt must NOT set the bar */
  const angErrContact = Math.acos(clamp(dot3(final.approach, approachDes), -1, 1));
  /* Legacy alias: flange error (solver reach uses flange) */
  const angErr = angErrFlange;
  const wristFlip = Math.abs(wrapAngle(q[3] - seed[3])) > 2.2
    || Math.abs(wrapAngle(q[4] - seed[4])) > 2.2;

  return {
    joints: q,
    reachable: posErr < 0.0005 && angErrFlange < (1 * PI) / 180,
    posErr,
    angErr,
    angErrFlange,
    angErrContact,
    wristFlip,
    approach: final.approach,
    contact: approachDes, /* shoe / UT contact = −normal */
    tcp: final.tcp,
    nSols: sols.length,
    cfg: { shoulder: pick.shoulder, elbow: pick.elbow, wrist: pick.wrist },
  };
}

export function roundTripTest(n = 50) {
  const errors = [];
  for (let i = 0; i < n; i++) {
    const q0 = [
      (Math.random() - 0.5) * 2,
      -0.8 - Math.random() * 1.2,
      0.8 + Math.random() * 1.4,
      -1.2 - Math.random() * 1.2,
      -0.8 - Math.random() * 1.4,
      (Math.random() - 0.5) * 2,
    ].map(wrapAngle);
    const pose = fkYUp(q0);
    const T = pose.T.slice();
    const sols = inverse(T, q0[5] < 0 ? q0[5] + 2 * PI : q0[5]);
    if (!sols.length) {
      errors.push({ posMm: 999, angDeg: 999, ok: false });
      continue;
    }
    /* find closest sol to q0 */
    let best = sols[0], bestD = Infinity;
    for (const s of sols) {
      let d = 0;
      for (let j = 0; j < 6; j++) d += Math.abs(wrapAngle(s.joints[j] - q0[j]));
      if (d < bestD) { bestD = d; best = s; }
    }
    const back = fkYUp(best.joints);
    const posMm = Math.hypot(back.tcp.x - pose.tcp.x, back.tcp.y - pose.tcp.y, back.tcp.z - pose.tcp.z) * 1000;
    const angDeg = Math.acos(clamp(dot3(back.approach, pose.approach), -1, 1)) * 180 / PI;
    errors.push({ posMm, angDeg, ok: true, nSols: sols.length });
  }
  const ok = errors.filter((e) => e.ok);
  return {
    maxPosMm: Math.max(...ok.map((e) => e.posMm), 0),
    maxAngDeg: Math.max(...ok.map((e) => e.angDeg), 0),
    meanPosMm: ok.reduce((s, e) => s + e.posMm, 0) / Math.max(ok.length, 1),
    nOk: ok.length,
    n: errors.length,
  };
}

export { fkYUp as fkPose };
