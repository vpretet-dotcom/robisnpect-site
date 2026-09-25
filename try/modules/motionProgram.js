/**
 * MotionProgram — approach / scan / retract / home.
 * Consumes PathStore densify; talks IK only via joint seeds in home.
 */
import { HOME_JOINTS, norm3 } from './ik.js';
import { densifyPath } from './pathStore.js';

/**
 * Build motion program from waypoints (UV-backed).
 * @param {object} part
 * @param {Array} waypoints
 * @param {{ densifyN?: number }} opts
 */
export function buildMotionProgram(part, waypoints, opts = {}) {
  const densifyN = opts.densifyN != null ? opts.densifyN : 3;
  const dens = densifyPath(part, waypoints, densifyN);
  const prog = [];
  const home = { joints: HOME_JOINTS.slice(), kind: 'home' };
  prog.push(home);
  if (!dens.length) return prog;
  const first = dens[0];
  const n0 = norm3(first.normal || { x: 0, y: 1, z: 0 });
  prog.push({
    x: first.x + n0.x * 0.04,
    y: first.y + n0.y * 0.04,
    z: first.z + n0.z * 0.04,
    normal: n0, kind: 'ptp', pen: false,
  });
  prog.push({ ...first, kind: 'descend', pen: false, normal: n0 });
  for (const p of dens) prog.push({ ...p, kind: 'scan', pen: true });
  const last = dens[dens.length - 1];
  const n1 = norm3(last.normal || n0);
  prog.push({
    x: last.x + n1.x * 0.04,
    y: last.y + n1.y * 0.04,
    z: last.z + n1.z * 0.04,
    normal: n1, kind: 'retract', pen: false,
  });
  prog.push(home);
  return prog;
}
