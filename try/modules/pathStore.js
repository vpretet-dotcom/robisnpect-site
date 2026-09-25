/**
 * PathStore — UV is truth; world = reproject(pose).
 * Edit/Draw write UV. Move-part reprojects without silent UV rewrite.
 */
import { HOME_JOINTS, solveIk, slerpVec } from './ik.js';

let _idSeq = 1;
export function nextWaypointId() { return `w${_idSeq++}`; }
export function resetWaypointIds(n = 1) { _idSeq = n; }

/**
 * Densify a waypoint polyline by UV lerp + part.project.
 * @param {object} part active part API with .project(u,v,true)
 * @param {Array} waypoints
 * @param {number} n segments per edge
 */
export function densifyPath(part, waypoints, n = 4) {
  if (!waypoints || waypoints.length < 2) return (waypoints || []).slice();
  const out = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const ua = a.u != null ? a.u : 0.5;
      const va = a.v != null ? a.v : 0.5;
      const ub = b.u != null ? b.u : 0.5;
      const vb = b.v != null ? b.v : 0.5;
      const u = ua + (ub - ua) * t;
      const v = va + (vb - va) * t;
      const p = part.project(u, v, true);
      if (p && p.ok) {
        out.push({
          x: p.x, y: p.y, z: p.z,
          normal: p.normal || slerpVec(a.normal || { x: 0, y: 1, z: 0 }, b.normal || { x: 0, y: 1, z: 0 }, t),
          u: p.u, v: p.v, id: a.id, pen: true,
        });
      }
    }
  }
  out.push({ ...waypoints[waypoints.length - 1], pen: true });
  return out;
}

/**
 * Reproject stored UV → world after part pose change.
 * P4.2 honesty: NEVER silent-clamp UV toward centre. Keep UV; flag unreachable.
 */
export function reprojectFromUV(part, waypoints, { seed = HOME_JOINTS } = {}) {
  const next = [];
  let prev = seed.slice();
  let unreachable = 0;
  const flags = [];
  for (const w of waypoints) {
    const u = w.u != null ? w.u : 0.5;
    const v = w.v != null ? w.v : 0.5;
    const p = part.project(u, v, true);
    if (!p || !p.ok) {
      unreachable++;
      flags.push({ id: w.id, u, v, reachable: false, reason: 'project' });
      next.push({
        ...w, u, v,
        x: w.x, y: w.y, z: w.z,
        normal: w.normal || { x: 0, y: 1, z: 0 },
        reachable: false,
        id: w.id || nextWaypointId(),
      });
      continue;
    }
    const ik = solveIk({ x: p.x, y: p.y, z: p.z }, p.normal, prev);
    const ok = !!ik.reachable;
    if (!ok) unreachable++;
    else prev = ik.joints;
    flags.push({ id: w.id, u, v, reachable: ok, reason: ok ? null : 'ik' });
    next.push({
      ...p,
      u, v, /* UV truth preserved — no pull-to-centre */
      id: w.id || nextWaypointId(),
      reachable: ok,
    });
  }
  return { waypoints: next, unreachable, n: next.length, flags };
}

export function waypointsFromPartDefault(part) {
  resetWaypointIds(1);
  return (part.defaultPath?.() || []).map((p) => ({ ...p, id: nextWaypointId(), reachable: true }));
}

export function waypointsFromRaster(part) {
  resetWaypointIds(1);
  const src = part.rasterPath ? part.rasterPath() : part.defaultPath();
  return (src || []).map((p) => ({ ...p, id: nextWaypointId(), reachable: true }));
}

/** Mean edge length in metres along densified UV path (for INDEX_STEP QA). */
export function meanEdgeSpacingM(part, waypoints, densifyN = 3) {
  const dens = densifyPath(part, waypoints, densifyN);
  if (dens.length < 2) return { mean: 0, min: 0, max: 0, n: 0 };
  let sum = 0, min = Infinity, max = 0, n = 0;
  for (let i = 0; i < dens.length - 1; i++) {
    const a = dens[i], b = dens[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    sum += d; n++;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { mean: n ? sum / n : 0, min: n ? min : 0, max, n };
}
