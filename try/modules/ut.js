/**
 * UT simulation (illustration only) — A-scan packets, coupling, in-material beam.
 * Contact 0° pulse-echo only. Pedagogical, not an instrument.
 *
 * P2:
 *  - depth on X-axis (ticks 0 / mid-thickness / backwall); mm on depth, %FSH on Y
 *  - Gate A: pipe/TOF tracks BWE (0.45–1.10×t); plate/aero between bang and backwall
 *  - defect echo + backwall drop/advance sync with C-scan indication
 */
import { partMeta } from './parts.js';
import { norm3, dot3 } from './ik.js';

export function createBeam(THREE) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.004, 0.007, 1, 12, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xe8c547, transparent: true, opacity: 0.0,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.5;
  group.add(mesh);
  let active = false;
  let coupling = 1;

  function setActive(v) { active = !!v; if (!v) { mat.opacity = 0; coupling = 0; } }
  function update(dt, { thickness = 0.01, couplingIn = 1, inContact = false } = {}) {
    coupling = couplingIn;
    if (!active || !inContact || coupling < 0.05) {
      mat.opacity *= Math.max(0, 1 - dt * 10);
      return;
    }
    const len = Math.max(0.003, thickness * 0.95);
    mesh.scale.set(1, len, 1);
    mesh.position.y = -len / 2;
    mat.opacity = 0.15 + 0.45 * coupling;
  }
  return { group, setActive, update, getCoupling: () => coupling };
}

export function couplingFromAngle(approach, normal) {
  const n = norm3(normal || { x: 0, y: 1, z: 0 });
  const a = norm3(approach || { x: 0, y: -1, z: 0 });
  const ang = Math.acos(clamp(dot3(a, { x: -n.x, y: -n.y, z: -n.z }), -1, 1));
  const deg = (ang * 180) / Math.PI;
  if (deg < 2) return { coupling: 1, deg };
  if (deg < 5) return { coupling: Math.max(0.05, 1 - (deg - 2) / 3 * 0.95), deg };
  return { coupling: 0, deg };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function createAscan(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let phase = 0;

  function packet(x0, amp, width, y0) {
    ctx.beginPath();
    ctx.strokeStyle = '#e8c547';
    ctx.lineWidth = 1.4;
    for (let x = Math.max(0, x0 - width * 3); x < Math.min(W, x0 + width * 4); x++) {
      const t = (x - x0) / width;
      const env = Math.exp(-t * t * 0.85);
      const rf = Math.sin(t * 14 + phase) * env * amp;
      const y = y0 - rf * H * 0.42;
      if (x === Math.max(0, x0 - width * 3)) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function depthToX(depthMm, depthMaxMm, padL, plotW) {
    return padL + plotW * clamp(depthMm / depthMaxMm, 0, 1);
  }

  function draw(dt, state = {}) {
    phase += dt * (state.scanning ? 16 : 3);
    const meta = state.meta || partMeta('aero');
    const thick = meta.thickness; /* m */
    const thickMm = thick * 1000;
    const depthMaxMm = thickMm * 1.25;
    const coupling = state.coupling ?? 0;
    const ampDef = (state.defectAmp || 0) * coupling;
    const defDepth = state.defectDepth; /* m or null */
    const isTof = meta.mode === 'tof';

    const padL = 30, padR = 36, padT = 8, padB = 16;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.fillStyle = '#0a0908';
    ctx.fillRect(0, 0, W, H);

    /* axes: X = depth (mm), Y = %FSH */
    ctx.strokeStyle = 'rgba(232,197,71,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB);
    ctx.stroke();

    ctx.fillStyle = 'rgba(154,149,138,0.9)';
    ctx.font = '9px IBM Plex Mono, monospace';
    /* %FSH on Y (left), NOT on depth side */
    ctx.fillText('%FSH', 2, padT + 8);
    /* mm on depth axis (bottom-right of X) */
    ctx.fillText('mm', W - padR + 4, H - 4);

    /* depth ticks: 0 / mid / backwall */
    const ticks = [
      { mm: 0, lab: '0' },
      { mm: thickMm * 0.5, lab: thickMm >= 8 ? (thickMm * 0.5).toFixed(0) : (thickMm * 0.5).toFixed(1) },
      { mm: thickMm, lab: thickMm >= 8 ? thickMm.toFixed(0) : thickMm.toFixed(1) },
    ];
    ctx.strokeStyle = 'rgba(232,197,71,0.28)';
    for (const t of ticks) {
      const x = depthToX(t.mm, depthMaxMm, padL, plotW);
      ctx.beginPath();
      ctx.moveTo(x, H - padB);
      ctx.lineTo(x, H - padB + 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(154,149,138,0.85)';
      ctx.fillText(t.lab, x - 6, H - 3);
    }

    /* Backwall depth early — Gate A must track BWE on pipe/TOF (Pascal) */
    let bwDepthMm = thickMm;
    if (isTof && ampDef > 0.2) {
      /* wall loss → earlier backwall (TOF advance) */
      bwDepthMm = thickMm * (1 - 0.42 * ampDef);
    }

    /* Gate A placement */
    let g0mm, g1mm;
    if (isTof) {
      /* pipe/TOF: Gate A tracks BWE (nominal + thinned), floored/capped 0.45–1.10×t */
      const half = thickMm * 0.16;
      g0mm = Math.max(thickMm * 0.45, bwDepthMm - half);
      g1mm = Math.min(thickMm * 1.10, bwDepthMm + thickMm * 0.12);
      if (g1mm - g0mm < thickMm * 0.18) {
        g0mm = Math.max(thickMm * 0.45, bwDepthMm - thickMm * 0.12);
        g1mm = Math.min(thickMm * 1.10, g0mm + thickMm * 0.28);
      }
    } else {
      /* plate/aero: between bang and backwall */
      g0mm = thickMm * 0.18;
      g1mm = thickMm * 0.72;
    }
    const g0 = depthToX(g0mm, depthMaxMm, padL, plotW);
    const g1 = depthToX(g1mm, depthMaxMm, padL, plotW);
    ctx.fillStyle = 'rgba(232,197,71,0.07)';
    ctx.fillRect(g0, padT, Math.max(4, g1 - g0), plotH);
    ctx.strokeStyle = 'rgba(232,197,71,0.4)';
    ctx.strokeRect(g0, padT, Math.max(4, g1 - g0), plotH);
    ctx.fillStyle = 'rgba(232,197,71,0.7)';
    ctx.font = '8px IBM Plex Mono, monospace';
    ctx.fillText('Gate A', g0 + 3, H - padB - 3);

    const baseY = padT + plotH * 0.78;

    /* grain */
    ctx.strokeStyle = 'rgba(232,197,71,0.12)';
    ctx.beginPath();
    for (let x = padL; x < W - padR; x++) {
      const n = (Math.sin(x * 0.37 + phase * 0.2) + Math.sin(x * 0.11 - phase)) * (meta.material === 'cfrp' ? 0.045 : 0.02);
      const y = baseY - n * plotH;
      if (x === padL) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (!state.scanning) return;
    if (coupling < 0.05) {
      ctx.fillStyle = 'rgba(200,80,60,0.85)';
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.fillText('coupling loss', padL + plotW * 0.28, padT + plotH * 0.4);
      return;
    }

    /* interface / main bang near 0 */
    packet(depthToX(0.4, depthMaxMm, padL, plotW), 0.55 * coupling, 5, baseY);

    /* defect echo at depth (plate/aero amplitude mode) */
    if (ampDef > 0.15 && defDepth != null && !isTof) {
      const xd = depthToX(defDepth * 1000, depthMaxMm, padL, plotW);
      packet(xd, (0.55 + ampDef * 0.45) * coupling, 4.5, baseY);
    }

    /* backwall — shadowed / advanced by defect (A↔C sync); bwDepthMm already set */
    const shadow = 1 - 0.85 * ampDef;
    let bwAmp = 0.85 * shadow * coupling;
    if (meta.material === 'cfrp') {
      const attLin = Math.pow(10, (-meta.att * 2 * thick * 1000) / 20);
      bwAmp *= attLin * 0.9;
    }
    const xb = depthToX(bwDepthMm, depthMaxMm, padL, plotW);
    packet(xb, Math.max(0.05, bwAmp), 5.5, baseY);

    /* SIM tag inside plot */
    ctx.fillStyle = 'rgba(232,197,71,0.55)';
    ctx.font = '8px IBM Plex Mono, monospace';
    ctx.fillText('SIM', W - padR - 22, padT + 10);
  }

  return { draw };
}

/** Map achieved tip → surface uv via part.project nearest */
export function tipToUV(part, tip) {
  const p = part.project(tip.x, tip.z);
  if (!p || !p.ok) return null;
  const gap = Math.hypot(tip.x - p.x, tip.y - p.y, tip.z - p.z);
  return { ...p, gap };
}
