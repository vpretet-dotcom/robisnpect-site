import { TIMING } from './world.js';
import { smoothstep } from './util.js';

/*
 * Step-5 pacing taken from the scripted acts, not tuned separately.
 * The act-2 path is drawn over this window of the 'path' act (acts.js),
 * with easeInOutSine; the act ends DRAW_END_ACT seconds in.
 */
const DRAW_T0 = 1.7;
const DRAW_T1 = 7.9;
const DRAW_END_ACT = 9.5;

/*
 * Speed factor per path segment, the same profile world.js applies to the
 * act-3 scan: a slow first pass, slower over indications, 1.2× on lifts
 * and 0.8× in U-turns.
 */
export function speedFactor(sample, firstPassEnd, near) {
  let f = 0.45 + 0.55 * smoothstep(0, firstPassEnd * 0.9, sample.s);
  for (const d of near(sample)) f *= 1 - 0.6 * (1 - smoothstep(0.025, 0.1, d));
  if (sample.kind === 'lift') f *= 1.2;
  if (sample.kind === 'turn') f *= 0.8;
  return f;
}

/** Act-3 nominal tool speed (m/s at f = 1), act-2 draw speed, and the act pauses. */
export function derivePacing(world) {
  const traj = world.traj;
  const samples = traj.samples;
  const firstPassEnd = traj.passInfo[0].s1;
  const inds = world.panel.indications;
  const near = (smp) => inds.map((ind) => Math.hypot(smp.X - ind.X, smp.Y - ind.Y));
  let weighted = 0;
  let turnTime = 0;
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i];
    const ds = b.s - samples[i - 1].s;
    const w = ds / speedFactor(b, firstPassEnd, near);
    weighted += w;
    if (b.kind === 'turn') turnTime += w;
  }
  const vScan = weighted / TIMING.scan;
  const A = TIMING.a3;
  return {
    vScan,
    vScanMean: traj.total / TIMING.scan,
    vDraw: traj.total / (DRAW_T1 - DRAW_T0),
    turnTime: turnTime / vScan / Math.max(1, traj.passInfo.length - 1),
    drawHold: DRAW_END_ACT - DRAW_T1,
    preApproach: A.approach0 - A.reveal0,
    approach: A.approach1 - A.approach0,
    descend: A.descend1 - A.approach1,
    lift: A.lift,
    settle: world.scanDuration - (A.descend1 + TIMING.scan + A.lift),
    retract: TIMING.a4.retract,
  };
}

/*
 * Time along a zone path at the act speed: cumulative seconds per sample,
 * so a long pass takes longer than a short one.
 */
export function timeProfile(traj, pacing, spots) {
  const samples = traj.samples;
  const firstPassEnd = traj.passInfo?.[0]?.s1 || traj.total;
  const near = (smp) => spots.map((sp) => sp.at.distanceTo(smp.p));
  const tCum = new Float32Array(samples.length);
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i];
    const ds = b.s - samples[i - 1].s;
    tCum[i] = tCum[i - 1] + ds / (pacing.vScan * speedFactor(b, firstPassEnd, near));
  }
  const duration = tCum[samples.length - 1] || 0;
  function sAt(tau) {
    if (tau <= 0) return 0;
    if (tau >= duration) return traj.total;
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tCum[mid] <= tau) lo = mid;
      else hi = mid;
    }
    const k = (tau - tCum[lo]) / (tCum[hi] - tCum[lo] || 1);
    return samples[lo].s + (samples[hi].s - samples[lo].s) * k;
  }
  const passTimes = (traj.passInfo || []).map((p) => {
    const i0 = samples.findIndex((s) => s.s >= p.s0);
    let i1 = samples.findIndex((s) => s.s >= p.s1);
    if (i1 < 0) i1 = samples.length - 1;
    return { len: p.s1 - p.s0, time: tCum[i1] - tCum[Math.max(0, i0)] };
  });
  return { duration, sAt, passTimes };
}
