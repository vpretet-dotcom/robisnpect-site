/**
 * ReachPolicy — contiguous UNREACH runs, drag preview, live badge.
 * Does NOT rewrite UV. Sébastien honesty.
 */
import { HOME_JOINTS, solveIk } from './ik.js';

/**
 * Evaluate reachability of waypoints (world xyz already set).
 * Returns runs of contiguous unreachable indices.
 */
export function evaluateReach(waypoints, { seed = HOME_JOINTS } = {}) {
  let prev = seed.slice();
  const flags = [];
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    const ik = solveIk(
      { x: w.x, y: w.y, z: w.z },
      w.normal || { x: 0, y: 1, z: 0 },
      prev,
    );
    const ok = !!ik.reachable;
    if (ok) prev = ik.joints;
    flags.push({
      i, id: w.id, reachable: ok,
      angErrContact: ik.angErrContact,
      angErrFlange: ik.angErrFlange,
      posErr: ik.posErr,
    });
  }
  const runs = contiguousUnreachRuns(flags);
  return {
    flags,
    runs,
    unreachableN: flags.filter((f) => !f.reachable).length,
    n: flags.length,
  };
}

/** Contiguous runs of unreachable waypoints: [{start, end, len}, ...] */
export function contiguousUnreachRuns(flags) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i].reachable) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ start, end: i - 1, len: i - start });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: flags.length - 1, len: flags.length - start });
  return runs;
}

/**
 * Preview reach for a candidate part pose without mutating store.
 * projectFn(u,v) → world point; uses current waypoints' UV.
 */
export function previewReachAtPose(waypoints, projectUv, { seed = HOME_JOINTS } = {}) {
  const projected = [];
  for (const w of waypoints) {
    const u = w.u != null ? w.u : 0.5;
    const v = w.v != null ? w.v : 0.5;
    const p = projectUv(u, v);
    if (!p || !p.ok) {
      projected.push({
        ...w, u, v, x: w.x, y: w.y, z: w.z,
        normal: w.normal || { x: 0, y: 1, z: 0 },
        reachable: false,
      });
    } else {
      projected.push({ ...p, u, v, id: w.id });
    }
  }
  return evaluateReach(projected, { seed });
}

/** Badge copy for live drag. Not a % alone — names UNREACH runs. */
export function badgeText(evalResult, lang = 'en') {
  const n = evalResult.unreachableN || 0;
  if (n <= 0) {
    return {
      show: false,
      text: '',
      level: 'ok',
    };
  }
  const runs = evalResult.runs || [];
  const runLabel = runs.length === 1
    ? (lang === 'fr' ? `1 plage` : `1 run`)
    : (lang === 'fr' ? `${runs.length} plages` : `${runs.length} runs`);
  const text = lang === 'fr'
    ? `UNREACH · ${n} pts · ${runLabel}`
    : `UNREACH · ${n} pts · ${runLabel}`;
  return { show: true, text, level: n > Math.max(2, (evalResult.n || 0) * 0.25) ? 'warn' : 'info', runs };
}

/** Ensure #try-reach-badge exists; update visibility/text. */
export function syncReachBadge(evalResult, lang = 'en') {
  let el = document.getElementById('try-reach-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'try-reach-badge';
    el.className = 'reach-badge';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    const host = document.getElementById('try-toolbar') || document.getElementById('try-root') || document.body;
    host.appendChild(el);
  }
  const b = badgeText(evalResult, lang);
  el.hidden = !b.show;
  el.textContent = b.text;
  el.dataset.level = b.level;
  el.classList.toggle('on', b.show);
  el.classList.toggle('warn', b.level === 'warn');
  return b;
}

export function hideReachBadge() {
  const el = document.getElementById('try-reach-badge');
  if (el) { el.hidden = true; el.classList.remove('on', 'warn'); el.textContent = ''; }
}
