import * as THREE from 'three';
import { patchMaterial } from './fx.js';
import { smoothstep } from './util.js';
import { measureLength, buildShell, addTable, makeField, makePainted, mountMesh, IND_THRESHOLD } from './parts.js';

/*
 * Four industrial parts for the "your turn" step, built like the weld,
 * elbow and fairing in parts.js: a parametric surface (s, t) in 0..1 with
 * exact point and normal, a painted C-scan skin, simulated indications
 * (spots) and the same contract for the planner, the coverage and the
 * report. Each part also states how its A-scan forms (`ascan`), from its
 * own wall thickness and the depth of each indication.
 *
 * The trajectories on these parts are computed in the browser by the same
 * planner as the others, not by TrajTool: the vignettes say "illustrative
 * trajectory". No turbine blade on purpose: it is an immersion part.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/* Unpainted bodies use the painted parts' highlight clamp, so both read as one material. */
function bodyMat(id, { color, metalness, roughness, clearcoat = 0, side }) {
  const mat = new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat, clearcoatRoughness: 0.22, envMapIntensity: 0.9, side: side ?? THREE.FrontSide });
  patchMaterial(mat, { specClamp: [0.3, 0.75, 0.28, 0.7] }, 'yt-body-' + id);
  return mat;
}

function add(group, geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  group.add(m);
  return m;
}

/* Box support from the floor up to `topY` (same dark steel as the tables). */
const SUPPORT = () => new THREE.MeshStandardMaterial({ color: 0x2b2a28, metalness: 0.55, roughness: 0.46 });
function addBlock(group, mat, x, z, w, d, topY, bottomY = 0) {
  const h = topY - bottomY;
  const m = add(group, new THREE.BoxGeometry(w, h, d), mat, 'yt-support');
  m.position.set(x, bottomY + h / 2, z);
  return m;
}

/* Bead tube along a closed or open curve. */
function beadTube(points, radius, closed) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, Math.max(64, points.length * 2), radius, 10, closed);
}

/*
 * A-scan model shared by the four parts. `x` is time on the trace (0..1),
 * the main bang sits at 0.055 as in hud.js. Each spot carries `depth`
 * (fraction of the local wall) and `shadow` (how much back-wall it hides).
 */
function spotWeight(part, sp, u, v) {
  const d = Math.hypot((u - sp.u) * part.lengthS, (v - sp.v) * part.lengthT) / sp.r;
  return 1 - smoothstep(0.75, 1.1, d);
}

function wallEchoes(part, u, v, { x0, k, th, multiple = 0.28, maxX = 0.97 }) {
  const echoes = [];
  let bw = 0.74;
  let hot = false;
  let grass = 0;
  for (const sp of part.spots) {
    const g = spotWeight(part, sp, u, v);
    if (g <= 0) continue;
    if (sp.kind === 'thin') {
      // Wall loss: the back wall itself comes earlier, the TOF shift is the indication.
      th = th * (1 - (1 - sp.depth) * g);
      bw *= 1 + 0.18 * g;
    } else if (sp.kind === 'porosity') {
      bw *= 1 - sp.shadow * g;
      grass = Math.max(grass, g);
    } else {
      echoes.push([x0 + k * th * sp.depth, Math.min(1, sp.amp * 1.04) * g]);
      bw *= 1 - sp.shadow * g;
    }
    if (g > 0.35 && sp.amp >= IND_THRESHOLD) hot = true;
  }
  const xb = x0 + k * th;
  echoes.push([xb, bw]);
  if (multiple && x0 + 2 * k * th < maxX) echoes.push([x0 + 2 * k * th, bw * multiple]);
  if (grass > 0) {
    for (let i = 1; i < 5; i++) echoes.push([x0 + k * th * (0.2 + 0.17 * i), 0.12 * grass * (1 - 0.12 * i)]);
  }
  return { echoes, hot, th };
}

/* ---------------------------------------------------------------------------
 * 1. Nozzle on shell (piquage sur virole). Shell axis along x, branch up.
 * s runs around the branch over one half (0° and 180° on the shell axis,
 * 90° on the flank where the saddle dips), t runs away from the weld toe.
 * The probe holder keeps D0 from the branch wall; the sectorial beam
 * reaches the weld root from there.
 * ------------------------------------------------------------------------- */
const NOZ = { R: 0.17, r: 0.056, Y0: 0.68, len: 0.74, wall: 0.012, toe: 0.012, D0: 0.034, D1: 0.09, hb: 0.13 };

function nozzleRho(t) {
  return NOZ.r + NOZ.D0 + t * (NOZ.D1 - NOZ.D0);
}

/* phi = π (1 − s): with s growing this way the skin's front faces point out, as on the plate. */
function nozzlePoint(s, t, out) {
  const phi = (1 - s) * Math.PI;
  const rho = nozzleRho(t);
  const x = rho * Math.cos(phi);
  const z = rho * Math.sin(phi);
  return out.set(x, NOZ.Y0 + Math.sqrt(NOZ.R * NOZ.R - z * z), z);
}

function nozzleNormal(s, t, out) {
  const phi = (1 - s) * Math.PI;
  const z = nozzleRho(t) * Math.sin(phi);
  return out.set(0, Math.sqrt(NOZ.R * NOZ.R - z * z), z).normalize();
}

const NOZ_SPOTS = [
  { id: '01', u: 0.55, v: 0.1, r: 0.011, amp: 0.93, kind: 'crack', depth: 0.8, shadow: 0 },
  { id: '02', u: 0.14, v: 0.16, r: 0.01, amp: 0.85, kind: 'lof', depth: 0.6, shadow: 0 },
  { id: '03', u: 0.8, v: 0.55, r: 0.012, amp: 0.63, kind: 'porosity', depth: 0.5, shadow: 0.2 },
];

export function createNozzlePart() {
  const lengthS = measureLength(nozzlePoint, 's');
  const lengthT = measureLength(nozzlePoint, 't');
  const field = makeField(71, {
    lengthS,
    lengthT,
    spots: NOZ_SPOTS,
    // Weld-root geometry stays faintly in the gate close to the toe.
    structure: (u, v) => 0.06 * Math.exp(-((v / 0.16) ** 2)) - 0.02 * Math.sin(u * Math.PI),
  });
  const look = { color: 0x66625c, metalness: 0.82, roughness: 0.4, clearcoat: 0.15 };
  const painted = makePainted('nozzle', { ...look, bead: false, field, overlay: true });
  const body = bodyMat('nozzle', look);
  const inner = bodyMat('nozzle-in', { ...look, color: 0x3a3834, side: THREE.BackSide });
  const group = new THREE.Group();
  group.name = 'yt-nozzle';

  // Shell: outer and inner skins, end rings.
  const shell = new THREE.CylinderGeometry(NOZ.R, NOZ.R, NOZ.len, 120, 1, true);
  shell.rotateZ(Math.PI / 2);
  add(group, shell, body).position.set(0, NOZ.Y0, 0);
  const shellIn = new THREE.CylinderGeometry(NOZ.R - NOZ.wall, NOZ.R - NOZ.wall, NOZ.len, 96, 1, true);
  shellIn.rotateZ(Math.PI / 2);
  add(group, shellIn, inner).position.set(0, NOZ.Y0, 0);
  for (const sx of [-1, 1]) {
    const ring = new THREE.RingGeometry(NOZ.R - NOZ.wall, NOZ.R, 120);
    ring.rotateY(sx * Math.PI / 2);
    add(group, ring, body).position.set((sx * NOZ.len) / 2, NOZ.Y0, 0);
  }
  // Branch, blind flange and bolts.
  const top = NOZ.Y0 + NOZ.R + NOZ.hb;
  const branchH = top - NOZ.Y0;
  add(group, new THREE.CylinderGeometry(NOZ.r, NOZ.r, branchH, 72, 1, true), body).position.set(0, NOZ.Y0 + branchH / 2, 0);
  add(group, new THREE.CylinderGeometry(NOZ.r + 0.03, NOZ.r + 0.03, 0.022, 72), body).position.set(0, top + 0.011, 0);
  add(group, new THREE.CylinderGeometry(NOZ.r + 0.012, NOZ.r + 0.012, 0.016, 64), body).position.set(0, top - 0.008, 0);
  const boltG = new THREE.CylinderGeometry(0.0055, 0.0055, 0.012, 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    add(group, boltG, body).position.set(Math.cos(a) * (NOZ.r + 0.021), top + 0.028, Math.sin(a) * (NOZ.r + 0.021));
  }
  // Fillet weld along the saddle intersection.
  const pts = [];
  const rb = NOZ.r + 0.004;
  for (let i = 0; i < 96; i++) {
    const phi = (i / 96) * Math.PI * 2;
    const z = rb * Math.sin(phi);
    pts.push(new THREE.Vector3(rb * Math.cos(phi), NOZ.Y0 + Math.sqrt(NOZ.R * NOZ.R - z * z) + 0.002, z));
  }
  const beadMat = bodyMat('nozzle-bead', { color: 0x4e4b46, metalness: 0.7, roughness: 0.66 });
  add(group, beadTube(pts, 0.0075, true), beadMat);
  // Painted skin over the scanned half.
  const geo = buildShell(nozzlePoint, nozzleNormal, 72, 24, 0.002);
  geo.translate(0, 0, 0);
  const pick = mountMesh(group, geo, painted.mat);
  pick.renderOrder = 1;
  // Saddle supports.
  const sup = SUPPORT();
  for (const sx of [-0.25, 0.25]) addBlock(group, sup, sx, 0, 0.06, 0.24, NOZ.Y0 - NOZ.R + 0.006);
  group.visible = false;

  const part = {
    id: 'nozzle',
    kind: 'raster',
    along: 's',
    lengthS,
    lengthT,
    edge: 0.008,
    swath: 0.02,
    lift: 0.05,
    point: nozzlePoint,
    normal: nozzleNormal,
    group,
    pick,
    uniforms: painted.uniforms,
    field,
    spots: NOZ_SPOTS,
    illustrative: true,
    method: 'angle',
    /* Robot behind the shell, so the camera keeps the flank in view. */
    bases: [
      { x: 0.05, y: 0.55, z: -0.85, ry: -Math.PI / 2 },
      { x: -0.28, y: 0.55, z: -0.85, ry: -Math.PI / 2 + 0.4 },
      { x: 0.32, y: 0.55, z: -0.85, ry: -Math.PI / 2 - 0.4 },
      { x: 0.05, y: 0.82, z: -0.85, ry: -Math.PI / 2 },
      { x: 0.05, y: 0.32, z: -1.0, ry: -Math.PI / 2 },
    ],
    locate(u, v) {
      const d = NOZ.D0 + v * (NOZ.D1 - NOZ.D0) - NOZ.toe;
      return { a: u * 180, b: d * 1000 };
    },
    /* Sectorial PAUT from the shell: no back wall, the weld-root corner echo moves out with the standoff. */
    ascan(u, v) {
      const dmm = (NOZ.D0 + v * (NOZ.D1 - NOZ.D0) - NOZ.toe) * 1000;
      const xr = 0.18 + 0.0062 * dmm;
      const echoes = [[xr, 0.36], [Math.min(0.96, xr + 0.21), 0.12]];
      let hot = false;
      for (const sp of NOZ_SPOTS) {
        const g = spotWeight(part, sp, u, v);
        if (g <= 0) continue;
        if (sp.kind === 'porosity') echoes.push([xr - 0.12, 0.3 * g], [xr - 0.08, 0.22 * g]);
        else echoes.push([xr - 0.045 * sp.depth, sp.amp * g]);
        if (g > 0.35 && sp.amp >= IND_THRESHOLD) hot = true;
      }
      return { echoes, hot };
    },
    ownsGroup: true,
    presets: {
      all: { s0: 0, s1: 1, t0: 0, t1: 1 },
      center: { s0: 0.26, s1: 0.74, t0: 0, t1: 0.62 },
      edge: { s0: 0, s1: 0.36, t0: 0, t1: 1 },
    },
    defaultPreset: 'center',
    shot: { az: 0.32, el: 0.6, radius: 0.36, fov: 30 },
    focus(out = new THREE.Vector3()) {
      nozzlePoint(0.5, 0.2, out);
      out.y += 0.04;
      return out;
    },
  };
  return part;
}

/* ---------------------------------------------------------------------------
 * 2. Tank dome on its shell (fond de réservoir, soudure fond-virole).
 * Vertical axis. t runs up a meridian: the shell below the weld, the
 * dome-to-shell weld at t = TW (flush, friction-stir style, thicker land),
 * then the ellipsoidal dome up to the polar boss. s runs around one half.
 * The rings get short at the pole, where every meridian meets.
 * ------------------------------------------------------------------------- */
const DOME = { a: 0.2, b: 0.13, Yw: 0.74, Hc: 0.085, cylDown: 0.3, TW: 0.3, aMax: (79 * Math.PI) / 180, thC: 0.0045, thD: 0.0035, thLand: 0.007, thBoss: 0.009 };
const DOME_TH0 = 0.97 - Math.PI / 2;

function domeMer(t) {
  if (t <= DOME.TW) return { rho: DOME.a, y: DOME.Yw - DOME.Hc * (1 - t / DOME.TW), al: 0 };
  const al = ((t - DOME.TW) / (1 - DOME.TW)) * DOME.aMax;
  return { rho: DOME.a * Math.cos(al), y: DOME.Yw + DOME.b * Math.sin(al), al };
}

function domePoint(s, t, out) {
  const th = DOME_TH0 + s * Math.PI;
  const m = domeMer(t);
  return out.set(m.rho * Math.cos(th), m.y, m.rho * Math.sin(th));
}

function domeNormal(s, t, out) {
  const th = DOME_TH0 + s * Math.PI;
  if (t <= DOME.TW) return out.set(Math.cos(th), 0, Math.sin(th));
  const al = ((t - DOME.TW) / (1 - DOME.TW)) * DOME.aMax;
  return out.set(DOME.b * Math.cos(al) * Math.cos(th), DOME.a * Math.sin(al), DOME.b * Math.cos(al) * Math.sin(th)).normalize();
}

/* Meridian arc length from the weld, metres (signed). */
function domeArc(t) {
  const n = 40;
  let L = 0;
  const lo = Math.min(t, DOME.TW);
  const hi = Math.max(t, DOME.TW);
  for (let i = 0; i < n; i++) {
    const m0 = domeMer(lo + ((hi - lo) * i) / n);
    const m1 = domeMer(lo + ((hi - lo) * (i + 1)) / n);
    L += Math.hypot(m1.rho - m0.rho, m1.y - m0.y);
  }
  return t < DOME.TW ? -L : L;
}

function domeThickness(t) {
  const land = Math.exp(-(((t - DOME.TW) / 0.06) ** 2));
  const boss = smoothstep(0.86, 1, t);
  const base = t < DOME.TW ? DOME.thC : DOME.thD;
  return base + (DOME.thLand - base) * land + (DOME.thBoss - DOME.thD) * boss;
}

const DOME_SPOTS = [
  { id: '01', u: 0.38, v: 0.3, r: 0.012, amp: 0.92, kind: 'lof', depth: 0.85, shadow: 0.55 },
  { id: '02', u: 0.63, v: 0.9, r: 0.01, amp: 0.85, kind: 'crack', depth: 0.6, shadow: 0.35 },
  { id: '03', u: 0.56, v: 0.6, r: 0.013, amp: 0.62, kind: 'porosity', depth: 0.5, shadow: 0.3 },
];

export function createDomePart() {
  const lengthS = measureLength(domePoint, 's');
  const lengthT = measureLength(domePoint, 't');
  const field = makeField(83, {
    lengthS,
    lengthT,
    spots: DOME_SPOTS,
    structure: (u, v) => -0.06 * Math.exp(-(((v - DOME.TW) / 0.035) ** 2)) + 0.04 * smoothstep(0.86, 1, v),
  });
  const look = { color: 0x77736c, metalness: 0.86, roughness: 0.34, clearcoat: 0.1 };
  const painted = makePainted('dome', { ...look, bead: false, beadV: { pos: DOME.TW, w: 0.022 }, field, overlay: true });
  const body = bodyMat('dome', look);
  const group = new THREE.Group();
  group.name = 'yt-dome';
  // Full shell and dome bodies (the painted half lies on top).
  const cylH = DOME.cylDown;
  add(group, new THREE.CylinderGeometry(DOME.a, DOME.a, cylH, 120, 1, true), body).position.set(0, DOME.Yw - cylH / 2, 0);
  const prof = [];
  for (let i = 0; i <= 40; i++) {
    const al = (i / 40) * (Math.PI / 2);
    prof.push(new THREE.Vector2(Math.max(1e-4, DOME.a * Math.cos(al)), DOME.b * Math.sin(al)));
  }
  add(group, new THREE.LatheGeometry(prof, 120), body).position.set(0, DOME.Yw, 0);
  // Flush weld land: a slightly rougher band all round.
  const landMat = bodyMat('dome-land', { ...look, color: 0x5d5a55, roughness: 0.6 });
  const land = new THREE.CylinderGeometry(DOME.a + 0.0006, DOME.a + 0.0006, 0.012, 120, 1, true);
  add(group, land, landMat).position.set(0, DOME.Yw - 0.005, 0);
  // Polar boss.
  const yPole = DOME.Yw + DOME.b;
  add(group, new THREE.CylinderGeometry(0.03, 0.034, 0.03, 48), body).position.set(0, yPole + 0.008, 0);
  add(group, new THREE.CylinderGeometry(0.016, 0.016, 0.014, 32), landMat).position.set(0, yPole + 0.03, 0);
  // Painted skin.
  const geo = buildShell(domePoint, domeNormal, 72, 40, 0.002);
  const pick = mountMesh(group, geo, painted.mat);
  pick.renderOrder = 1;
  addTable(group, 0, DOME.Yw - cylH - 0.009, 0, 0.5, 0.5);
  group.visible = false;

  const part = {
    id: 'dome',
    kind: 'raster',
    along: 's',
    lengthS,
    lengthT,
    edge: 0.01,
    swath: 0.026,
    lift: 0.05,
    point: domePoint,
    normal: domeNormal,
    group,
    pick,
    uniforms: painted.uniforms,
    field,
    spots: DOME_SPOTS,
    illustrative: true,
    method: 'ut',
    locate(u, v) {
      return { a: u * 180, b: Math.abs(domeArc(v)) * 1000 };
    },
    /* Contact UT: back wall at the local wall (thin membrane, thick weld land and boss). */
    ascan(u, v) {
      return wallEchoes(part, u, v, { x0: 0.1, k: 62, th: domeThickness(v) });
    },
    ownsGroup: true,
    presets: {
      all: { s0: 0, s1: 1, t0: 0, t1: 1 },
      center: { s0: 0.22, s1: 0.78, t0: 0.08, t1: 0.55 },
      edge: { s0: 0.12, s1: 0.88, t0: 0.62, t1: 1 },
    },
    defaultPreset: 'center',
    shot: { az: 0.9, el: 0.5, radius: 0.5, fov: 30 },
    focus(out = new THREE.Vector3()) {
      out.set(0.06, DOME.Yw + 0.03, 0.09);
      return out;
    },
  };
  return part;
}

/* ---------------------------------------------------------------------------
 * 3. Stiffened composite panel, stringer feet (pied de lisse). Skin with a
 * gentle curvature and two T stringers along t. Each foot rises from the
 * skin through a radius, so the normal tilts across it. Passes run across
 * (along s); the probe holder cannot get closer than CLEAR to a web, so it
 * lifts over each stringer.
 * ------------------------------------------------------------------------- */
const STR = { W: 0.5, L: 0.42, Y: 0.84, Rc: 2.2, xs: [-0.12, 0.12], fw: 0.034, ft: 0.0045, tl: 0.014, webH: 0.04, webT: 0.004, capW: 0.024, capT: 0.004, clear: 0.024, skin: 0.004 };

function footH(x) {
  let h = 0;
  let dh = 0;
  for (const xc of STR.xs) {
    const d = Math.abs(x - xc);
    const k = Math.min(1, Math.max(0, (d - STR.fw) / STR.tl));
    h += STR.ft * (1 - k * k * (3 - 2 * k));
    if (k > 0 && k < 1) dh += -STR.ft * ((6 * k * (1 - k)) / STR.tl) * Math.sign(x - xc);
  }
  return { h, dh };
}

function stringerPoint(s, t, out) {
  const x = (s - 0.5) * STR.W;
  const z = (t - 0.5) * STR.L;
  return out.set(x, STR.Y - (x * x) / (2 * STR.Rc) + footH(x).h, z);
}

function stringerNormal(s, t, out) {
  const x = (s - 0.5) * STR.W;
  const dy = -x / STR.Rc + footH(x).dh;
  return out.set(-dy, 1, 0).normalize();
}

function webDist(s) {
  const x = (s - 0.5) * STR.W;
  let d = Infinity;
  for (const xc of STR.xs) d = Math.min(d, Math.abs(x - xc));
  return d;
}

const STR_SPOTS = [
  { id: '01', u: 0.5 + (STR.xs[1] - 0.03) / STR.W, v: 0.66, r: 0.012, amp: 0.93, kind: 'disbond', depth: 0.5, shadow: 0.85 },
  { id: '02', u: 0.5, v: 0.24, r: 0.014, amp: 0.86, kind: 'delam', depth: 0.42, shadow: 0.7 },
  { id: '03', u: 0.5 + -0.2 / STR.W, v: 0.72, r: 0.02, amp: 0.64, kind: 'porosity', depth: 0.5, shadow: 0.45 },
];

export function createStringerPart() {
  const lengthS = STR.W;
  const lengthT = STR.L;
  const field = makeField(97, {
    lengthS,
    lengthT,
    spots: STR_SPOTS,
    structure(u) {
      const x = (u - 0.5) * STR.W;
      return 0.05 * footH(x).h / STR.ft;
    },
  });
  const look = { color: 0x2a2a28, metalness: 0.08, roughness: 0.46, clearcoat: 0.85 };
  const painted = makePainted('stringer', { ...look, bead: false, field });
  const body = bodyMat('stringer', look);
  const group = new THREE.Group();
  group.name = 'yt-stringer';
  const geo = buildShell(stringerPoint, stringerNormal, 160, 30, STR.skin);
  const pick = mountMesh(group, geo, painted.mat);
  // T stringers: web and cap on each foot.
  for (const xc of STR.xs) {
    const y0 = stringerPoint(0.5 + xc / STR.W, 0.5, _a).y;
    add(group, new THREE.BoxGeometry(STR.webT, STR.webH, STR.L), body).position.set(xc, y0 + STR.webH / 2, 0);
    add(group, new THREE.BoxGeometry(STR.capW, STR.capT, STR.L), body).position.set(xc, y0 + STR.webH + STR.capT / 2, 0);
    // Web-to-foot radius fillets.
    for (const sx of [-1, 1]) {
      const sh = new THREE.Shape();
      const R = 0.006;
      sh.moveTo(0, 0);
      sh.lineTo(R, 0);
      sh.absarc(R, R, R, -Math.PI / 2, -Math.PI, true);
      sh.lineTo(0, 0);
      const fg = new THREE.ExtrudeGeometry(sh, { depth: STR.L, bevelEnabled: false, curveSegments: 8 });
      fg.translate(0, 0, -STR.L / 2);
      const m = add(group, fg, body);
      m.scale.x = sx;
      m.position.set(xc + (sx * STR.webT) / 2, y0, 0);
    }
  }
  addTable(group, 0, STR.Y - STR.skin - 0.03, 0, 0.42, 0.36);
  group.visible = false;

  const part = {
    id: 'stringer',
    kind: 'raster',
    along: 's',
    lengthS,
    lengthT,
    edge: 0.012,
    swath: 0.034,
    lift: 0.07,
    point: stringerPoint,
    normal: stringerNormal,
    blocked(s) {
      return webDist(s) < STR.webT / 2 + STR.clear;
    },
    group,
    pick,
    uniforms: painted.uniforms,
    field,
    spots: STR_SPOTS,
    illustrative: true,
    method: 'composite',
    locate(u, v) {
      return { a: v * STR.L * 1000, b: webDist(u) * 1000 };
    },
    /* Composite pulse-echo: thin skin in the bays, skin + foot on the feet; delaminations answer shallow. */
    ascan(u, v) {
      const x = (u - 0.5) * STR.W;
      const th = (STR.skin + footH(x).h) * 1000;
      return wallEchoes(part, u, v, { x0: 0.1, k: 0.058, th, multiple: 0.34 });
    },
    ownsGroup: true,
    presets: {
      all: { s0: 0, s1: 1, t0: 0, t1: 1 },
      center: { s0: 0.2, s1: 0.8, t0: 0.3, t1: 0.74 },
      edge: { s0: 0.6, s1: 0.98, t0: 0.5, t1: 0.92 },
    },
    defaultPreset: 'center',
    shot: { az: 0.62, el: 0.62, radius: 0.44, fov: 30 },
    focus(out = new THREE.Vector3()) {
      return stringerPoint(0.5, 0.5, out);
    },
  };
  return part;
}

/* ---------------------------------------------------------------------------
 * 4. Concentric reducer (cône de réduction). Axis along x, large end at
 * x0. The profile has knuckles, so the wall angle changes along the part,
 * and the wall thins from TH1 to TH2 with it: on every axial pass the
 * A-scan back wall walks in (time of flight) as the probe moves.
 * ------------------------------------------------------------------------- */
const CONE = { x0: -0.24, x1: 0.24, R1: 0.16, R2: 0.08, Yc: 0.74, th1: 0.014, th2: 0.008, k0: 0.14, k1: 0.86, psiC: 0.62, span: 0.94 * Math.PI };

function coneK(t) {
  const k = Math.min(1, Math.max(0, (t - CONE.k0) / (CONE.k1 - CONE.k0)));
  return { S: k * k * (3 - 2 * k), dS: (6 * k * (1 - k)) / (CONE.k1 - CONE.k0) };
}
function coneR(t) {
  return CONE.R1 + (CONE.R2 - CONE.R1) * coneK(t).S;
}
function coneThickness(t) {
  return CONE.th1 + (CONE.th2 - CONE.th1) * coneK(t).S;
}
function conePsi(s) {
  return CONE.psiC - (s - 0.5) * CONE.span;
}

function conePoint(s, t, out) {
  const x = CONE.x0 + t * (CONE.x1 - CONE.x0);
  const r = coneR(t);
  const psi = conePsi(s);
  return out.set(x, CONE.Yc + r * Math.cos(psi), r * Math.sin(psi));
}

function coneNormal(s, t, out) {
  const drdx = ((CONE.R2 - CONE.R1) * coneK(t).dS) / (CONE.x1 - CONE.x0);
  const psi = conePsi(s);
  return out.set(-drdx, Math.cos(psi), Math.sin(psi)).normalize();
}

const CONE_SPOTS = [
  { id: '01', u: 0.6, v: 0.8, r: 0.016, amp: 0.92, kind: 'thin', depth: 0.58, shadow: 0 },
  { id: '02', u: 0.36, v: 0.46, r: 0.012, amp: 0.86, kind: 'lamination', depth: 0.5, shadow: 0.75 },
  { id: '03', u: 0.72, v: 0.24, r: 0.02, amp: 0.63, kind: 'thin', depth: 0.9, shadow: 0 },
];

export function createConePart() {
  const lengthS = measureLength(conePoint, 's');
  const lengthT = measureLength(conePoint, 't');
  // Thickness C-scan: the thinner the wall, the hotter; sound wall stays under the threshold.
  const field = makeField(109, {
    lengthS,
    lengthT,
    spots: CONE_SPOTS,
    structure: (u, v) => 0.11 * coneK(v).S - 0.05,
  });
  const look = { color: 0x5f5b55, metalness: 0.8, roughness: 0.42, clearcoat: 0.12 };
  const painted = makePainted('cone', { ...look, bead: false, field, overlay: true });
  const body = bodyMat('cone', look);
  const inner = bodyMat('cone-in', { ...look, color: 0x34322e, side: THREE.BackSide });
  const group = new THREE.Group();
  group.name = 'yt-cone';
  // Reducer body (full turn) by lathe around x, then the pipe stubs.
  const prof = [];
  const profIn = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const x = CONE.x0 + t * (CONE.x1 - CONE.x0);
    prof.push(new THREE.Vector2(coneR(t), x));
    profIn.push(new THREE.Vector2(coneR(t) - coneThickness(t), x));
  }
  const lathe = (p, mat) => {
    const g = new THREE.LatheGeometry(p, 120);
    g.rotateZ(-Math.PI / 2);
    const m = add(group, g, mat);
    m.position.set(0, CONE.Yc, 0);
    return m;
  };
  lathe(prof, body);
  lathe(profIn, inner);
  const stubL = 0.1;
  const pipe = (r, th, x, len) => {
    const g = new THREE.CylinderGeometry(r, r, len, 96, 1, true);
    g.rotateZ(Math.PI / 2);
    add(group, g, body).position.set(x, CONE.Yc, 0);
    const gi = new THREE.CylinderGeometry(r - th, r - th, len, 72, 1, true);
    gi.rotateZ(Math.PI / 2);
    add(group, gi, inner).position.set(x, CONE.Yc, 0);
    const ring = new THREE.RingGeometry(r - th, r, 96);
    const end = x + Math.sign(x) * (len / 2);
    ring.rotateY(Math.sign(x) * (Math.PI / 2));
    add(group, ring, body).position.set(end, CONE.Yc, 0);
  };
  pipe(CONE.R1, CONE.th1, CONE.x0 - stubL / 2, stubL);
  pipe(CONE.R2, CONE.th2, CONE.x1 + stubL / 2, stubL);
  // Girth welds at both ends.
  const beadMat = bodyMat('cone-bead', { color: 0x4e4b46, metalness: 0.7, roughness: 0.66 });
  for (const [x, r] of [
    [CONE.x0, CONE.R1],
    [CONE.x1, CONE.R2],
  ]) {
    const g = new THREE.TorusGeometry(r + 0.0015, 0.0065, 10, 120);
    g.rotateY(Math.PI / 2);
    add(group, g, beadMat).position.set(x, CONE.Yc, 0);
  }
  const geo = buildShell(conePoint, coneNormal, 64, 48, 0.002);
  const pick = mountMesh(group, geo, painted.mat);
  pick.renderOrder = 1;
  const sup = SUPPORT();
  addBlock(group, sup, CONE.x0 - stubL * 0.55, 0, 0.05, 0.2, CONE.Yc - CONE.R1 + 0.004);
  addBlock(group, sup, CONE.x1 + stubL * 0.55, 0, 0.05, 0.14, CONE.Yc - CONE.R2 + 0.004);
  group.visible = false;

  const part = {
    id: 'cone',
    kind: 'raster',
    along: 't',
    lengthS,
    lengthT,
    edge: 0.012,
    swath: 0.03,
    lift: 0.05,
    point: conePoint,
    normal: coneNormal,
    group,
    pick,
    uniforms: painted.uniforms,
    field,
    spots: CONE_SPOTS,
    illustrative: true,
    method: 'tof',
    locate(u, v) {
      const top = Math.abs(conePsi(u)) * (180 / Math.PI);
      return { a: v * (CONE.x1 - CONE.x0) * 1000, b: top };
    },
    /* Contact UT, 0°: the back wall sits at the local wall thickness, so it walks in along the cone. */
    ascan(u, v) {
      return wallEchoes(part, u, v, { x0: 0.1, k: 42, th: coneThickness(v), multiple: 0 });
    },
    ownsGroup: true,
    presets: {
      all: { s0: 0, s1: 1, t0: 0, t1: 1 },
      center: { s0: 0.25, s1: 0.75, t0: 0.12, t1: 0.88 },
      edge: { s0: 0.18, s1: 0.82, t0: 0.58, t1: 1 },
    },
    defaultPreset: 'center',
    shot: { az: 0.7, el: 0.5, radius: 0.5, fov: 30 },
    focus(out = new THREE.Vector3()) {
      return conePoint(0.5, 0.5, out);
    },
  };
  return part;
}

export const INDUSTRIAL_FACTORIES = {
  nozzle: createNozzlePart,
  dome: createDomePart,
  stringer: createStringerPart,
  cone: createConePart,
};
