import * as THREE from 'three';
import { P, surfacePoint, radiusAt, holeLevel, RAMP } from './panel.js';
import { patchMaterial, GOLD_LIN } from './fx.js';
import { mulberry32 } from './util.js';

/*
 * Illustrative parts for the "your turn" step. Each one is a parametric
 * surface (s, t) plus a mesh. The curved panel reuses the act geometry.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _r = new THREE.Vector3();

/*
 * Finite-difference normal. Partials are normalised before the cross so the
 * degeneracy test is an angle, not a world-space length: a small shell
 * (the fairing nose is a few centimetres) used to fall under an absolute
 * lengthSq cut and collapse to +Y. Sign is dt × ds, the outward winding of
 * the plate, elbow and panel. The fairing uses analytic ∂s × ∂t instead,
 * which is the outward direction for that parameterisation.
 */
function numericNormal(point, s, t, out) {
  const e = 2e-4;
  const s0 = Math.max(0, s - e);
  const s1 = Math.min(1, s + e);
  const t0 = Math.max(0, t - e);
  const t1 = Math.min(1, t + e);
  point(s1, t, _b);
  point(s0, t, _a);
  const ds = _c.copy(_b).sub(_a);
  point(s, t1, _b);
  point(s, t0, _a);
  const dt = _b.sub(_a);
  const dsL = ds.length();
  const dtL = dt.length();
  if (dsL < 1e-12 || dtL < 1e-12) return out.set(0, 1, 0);
  ds.multiplyScalar(1 / dsL);
  dt.multiplyScalar(1 / dtL);
  out.crossVectors(dt, ds);
  if (out.lengthSq() < 1e-8) return out.set(0, 1, 0);
  return out.normalize();
}

function measureLength(point, axis) {
  let L = 0;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    if (axis === 's') {
      point(u0, 0.5, _a);
      point(u1, 0.5, _b);
    } else {
      point(0.5, u0, _a);
      point(0.5, u1, _b);
    }
    L += _a.distanceTo(_b);
  }
  return Math.max(L, 0.05);
}

function buildShell(point, normal, ns, nt, thick) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const grid = ns + 1;
  for (let j = 0; j <= nt; j++) {
    const t = j / nt;
    for (let i = 0; i <= ns; i++) {
      const s = i / ns;
      point(s, t, _p);
      const px = _p.x;
      const py = _p.y;
      const pz = _p.z;
      normal(s, t, _q);
      pos.push(px, py, pz);
      nor.push(_q.x, _q.y, _q.z);
      uv.push(s, t);
    }
  }
  const topCount = pos.length / 3;
  for (let k = 0; k < topCount; k++) {
    pos.push(pos[k * 3] - nor[k * 3] * thick, pos[k * 3 + 1] - nor[k * 3 + 1] * thick, pos[k * 3 + 2] - nor[k * 3 + 2] * thick);
    nor.push(-nor[k * 3], -nor[k * 3 + 1], -nor[k * 3 + 2]);
    uv.push(uv[k * 2], uv[k * 2 + 1]);
  }
  const quad = (a, b, c, d, flip) => {
    if (!flip) idx.push(a, c, b, b, c, d);
    else idx.push(a, b, c, b, d, c);
  };
  for (let j = 0; j < nt; j++) {
    for (let i = 0; i < ns; i++) {
      const a = j * grid + i;
      quad(a, a + 1, a + grid, a + grid + 1, false);
      const e = topCount + a;
      quad(e, e + 1, e + grid, e + grid + 1, true);
    }
  }
  const edge = (i0, j0, i1, j1) => {
    const steps = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
    for (let k = 0; k < steps; k++) {
      const iA = i0 + Math.sign(i1 - i0) * k;
      const jA = j0 + Math.sign(j1 - j0) * k;
      const iB = i0 + Math.sign(i1 - i0) * (k + 1);
      const jB = j0 + Math.sign(j1 - j0) * (k + 1);
      const a = jA * grid + iA;
      const b = jB * grid + iB;
      quad(a, b, topCount + a, topCount + b, false);
    }
  };
  edge(0, 0, ns, 0);
  edge(ns, 0, ns, nt);
  edge(ns, nt, 0, nt);
  edge(0, nt, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function addTable(group, x, topY, z, w, d) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2a28, metalness: 0.55, roughness: 0.46 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, d), mat);
  top.name = 'yt-support';
  top.position.set(x, topY, z);
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);
  const legH = Math.max(0.08, topY - 0.009);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.028, legH, 0.028), mat);
      leg.name = 'yt-support';
      leg.position.set(x + sx * (w * 0.5 - 0.04), legH / 2, z + sz * (d * 0.5 - 0.04));
      leg.castShadow = true;
      leg.receiveShadow = true;
      group.add(leg);
    }
  }
}

function rampGLSL() {
  return RAMP.map(([p], i) => {
    const prev = i === 0 ? 0 : RAMP[i - 1][0];
    const k = i === 0 ? '1.0' : `((v - ${prev.toFixed(3)}) / ${(p - prev).toFixed(4)})`;
    return `if (v <= ${p.toFixed(3)}) return mix(uRampC[${Math.max(i - 1, 0)}], uRampC[${i}], ${k});`;
  }).join('\n');
}

function makeField(seed, spots) {
  const w = 128;
  const h = 128;
  const rnd = mulberry32(seed);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      let val = 0.42 + (rnd() - 0.5) * 0.07;
      val += Math.sin(u * 48 + seed) * Math.cos(v * 40 + seed * 0.2) * 0.035;
      for (const spot of spots) {
        const d = Math.hypot((u - spot.u) / spot.ru, (v - spot.v) / spot.rv);
        const g = Math.exp(-d * d * 1.4);
        val = val * (1 - g) + spot.amp * g;
      }
      val = Math.min(0.98, Math.max(0.06, val));
      const o = (y * w + x) * 4;
      rgba[o] = Math.round(val * 255);
      rgba[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const RAMP_SRC = rampGLSL();

function makePainted(id, { color, metalness, roughness, clearcoat, bead }) {
  const field = makeField(id.length * 17 + 3, [
    { u: 0.62, v: 0.58, ru: 0.08, rv: 0.06, amp: 0.92 },
    { u: 0.38, v: 0.42, ru: 0.05, rv: 0.1, amp: 0.78 },
  ]);
  const cover = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  cover.needsUpdate = true;
  const uniforms = {
    uField: { value: field },
    uCover: { value: cover },
    uCscan: { value: 0 },
    uCscanGain: { value: 2.15 },
    uScanNow: { value: 0 },
    uGlow: { value: 0 },
    uBead: { value: bead ? 1 : 0 },
    uRampC: { value: RAMP.map(([, hex]) => new THREE.Color(hex).convertSRGBToLinear()) },
    uGold: { value: GOLD_LIN.clone() },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness,
    roughness,
    clearcoat: clearcoat || 0,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.9,
  });
  patchMaterial(
    mat,
    {
      uniforms,
      fragPars: `
        uniform sampler2D uField; uniform sampler2D uCover;
        uniform float uCscan; uniform float uCscanGain; uniform float uScanNow; uniform float uGlow; uniform float uBead;
        uniform vec3 uRampC[${RAMP.length}]; uniform vec3 uGold;
        vec3 goldRamp(float v) {
          ${RAMP_SRC}
          return uRampC[${RAMP.length - 1}];
        }
      `,
      fragColor: `
        float beadTint = uBead * exp(-pow((vFxUv.x - 0.5) / 0.055, 2.0));
        diffuseColor.rgb *= mix(1.0, 0.78, beadTint);
        vec4 fxCov = texture2D(uCover, vFxUv);
        float covered = clamp(fxCov.r, 0.0, 1.0) * uCscan;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.25, covered);
      `,
      fragEmissive: `
        vec4 fxCovE = texture2D(uCover, vFxUv);
        vec4 fxFldE = texture2D(uField, vFxUv);
        float coveredE = clamp(fxCovE.r, 0.0, 1.0) * uCscan;
        float val = fxFldE.r * (0.94 + 0.1 * fxCovE.b);
        vec3 cs = goldRamp(clamp(val, 0.0, 1.0));
        float fresh = coveredE * uGlow * clamp(1.0 - (uScanNow - fxCovE.g) * 14.0, 0.0, 1.0);
        totalEmissiveRadiance += cs * coveredE * uCscanGain * (1.0 + fresh);
      `,
      fragMaterial: `
        float beadRough = uBead * exp(-pow((vFxUv.x - 0.5) / 0.055, 2.0));
        material.roughness = mix(material.roughness, 0.66, beadRough);
        float coveredM = clamp(texture2D(uCover, vFxUv).r, 0.0, 1.0) * uCscan;
        material.clearcoat *= 1.0 - 0.65 * coveredM;
      `,
    },
    'yt-paint-' + id
  );
  return { mat, uniforms, field, cover };
}

function presetsRect() {
  return {
    all: { s0: 0, s1: 1, t0: 0, t1: 1 },
    center: { s0: 0.28, s1: 0.72, t0: 0.3, t1: 0.7 },
    edge: { s0: 0, s1: 0.24, t0: 0.1, t1: 0.9 },
  };
}

function mountMesh(group, geo, mat) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/* Welded plate: flat, with a bead along t at s = 0.5. */
const WELD = { W: 0.56, L: 0.4, Y: 0.84, H: 0.012, sig: 0.013, thick: 0.014 };

function weldPoint(s, t, out) {
  const x = (s - 0.5) * WELD.W;
  const z = (t - 0.5) * WELD.L;
  const bead = WELD.H * Math.exp(-(x * x) / (2 * WELD.sig * WELD.sig));
  return out.set(x, WELD.Y + bead, z);
}

function weldNormal(s, t, out) {
  const x = (s - 0.5) * WELD.W;
  const bead = WELD.H * Math.exp(-(x * x) / (2 * WELD.sig * WELD.sig));
  const dBeads = bead * (-x / (WELD.sig * WELD.sig)) * WELD.W;
  return out.set(-dBeads, WELD.W, 0).normalize();
}

export function createWeldPart() {
  const painted = makePainted('weld', { color: 0x6a6660, metalness: 0.82, roughness: 0.4, clearcoat: 0.15, bead: true });
  const group = new THREE.Group();
  group.name = 'yt-weld';
  const geo = buildShell(weldPoint, weldNormal, 64, 36, WELD.thick);
  const pick = mountMesh(group, geo, painted.mat);
  addTable(group, 0, WELD.Y - WELD.thick - 0.012, 0, 0.4, 0.26);
  group.visible = false;
  return {
    id: 'weld',
    kind: 'weld',
    along: 't',
    lengthS: WELD.W,
    lengthT: WELD.L,
    edge: 0.016,
    swath: 0.02,
    lift: 0.04,
    weldOffsets: [-0.034, -0.017, 0, 0.017, 0.034],
    point: weldPoint,
    normal: weldNormal,
    group,
    pick,
    uniforms: painted.uniforms,
    ownsGroup: true,
    presets: {
      all: { s0: 0.42, s1: 0.58, t0: 0, t1: 1 },
      center: { s0: 0.42, s1: 0.58, t0: 0.3, t1: 0.7 },
      edge: { s0: 0.42, s1: 0.58, t0: 0, t1: 0.38 },
    },
    defaultPreset: 'center',
    shot: { az: 0.85, el: 0.7, radius: 0.55, fov: 30 },
    focus(out = new THREE.Vector3()) {
      return weldPoint(0.5, 0.5, out);
    },
  };
}

/* Pipe elbow: torus section. Curvature turns along t. Passes follow the bend. */
const ELBOW = { R: 0.3, r: 0.062, phi0: 0.18, phi1: 1.42, alpha: 2.15, ox: -0.08, oy: 0.784, oz: 0.16, thick: 0.007 };

function elbowFrame(t) {
  const phi = ELBOW.phi0 + t * (ELBOW.phi1 - ELBOW.phi0);
  return {
    phi,
    cx: ELBOW.ox + ELBOW.R * Math.sin(phi),
    cy: ELBOW.oy,
    cz: ELBOW.oz - ELBOW.R * Math.cos(phi),
    ox: Math.sin(phi),
    oz: -Math.cos(phi),
  };
}

function elbowPoint(s, t, out) {
  const f = elbowFrame(t);
  const alpha = (s - 0.5) * ELBOW.alpha;
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  return out.set(f.cx + ELBOW.r * sa * f.ox, f.cy + ELBOW.r * ca, f.cz + ELBOW.r * sa * f.oz);
}

function elbowNormal(s, t, out) {
  const f = elbowFrame(t);
  const alpha = (s - 0.5) * ELBOW.alpha;
  return out.set(Math.sin(alpha) * f.ox, Math.cos(alpha), Math.sin(alpha) * f.oz).normalize();
}

export function createElbowPart() {
  const painted = makePainted('elbow', { color: 0x5c5954, metalness: 0.78, roughness: 0.38, clearcoat: 0.2, bead: false });
  const group = new THREE.Group();
  group.name = 'yt-elbow';
  const geo = buildShell(elbowPoint, elbowNormal, 36, 48, ELBOW.thick);
  const pick = mountMesh(group, geo, painted.mat);
  const mid = elbowPoint(0.5, 0.5, new THREE.Vector3());
  addTable(group, mid.x, 0.80, mid.z, 0.28, 0.28);
  group.visible = false;
  return {
    id: 'elbow',
    kind: 'raster',
    along: 't',
    lengthS: measureLength(elbowPoint, 's'),
    lengthT: measureLength(elbowPoint, 't'),
    edge: 0.012,
    swath: 0.028,
    lift: 0.04,
    maxPasses: 6,
    point: elbowPoint,
    normal: elbowNormal,
    group,
    pick,
    uniforms: painted.uniforms,
    ownsGroup: true,
    presets: {
      all: { s0: 0, s1: 1, t0: 0, t1: 1 },
      center: { s0: 0.16, s1: 0.84, t0: 0.2, t1: 0.8 },
      edge: { s0: 0.08, s1: 0.92, t0: 0, t1: 0.38 },
    },
    defaultPreset: 'center',
    shot: { az: 0.7, el: 0.52, radius: 0.2, fov: 30 },
    focus(out = new THREE.Vector3()) {
      return elbowPoint(0.5, 0.5, out);
    },
  };
}

/* Doubly curved leading-edge fairing. s wraps the nose, t runs the span. */
const FAIR = { span: 0.64, ang: 2.15, y: 0.9, z0: 0.06, thick: 0.007 };

function fairRadius(t) {
  return 0.058 * (1.2 - 0.55 * t);
}

function fairingPoint(s, t, out) {
  const r = fairRadius(t);
  const ang = (s - 0.5) * FAIR.ang;
  const x = (t - 0.5) * FAIR.span;
  const sweep = 0.15 * t * t;
  const dih = 0.07 * (t - 0.5);
  const bow = 0.028 * Math.sin(t * Math.PI);
  const z = FAIR.z0 + sweep - r * Math.cos(ang);
  const y = FAIR.y + dih + bow + r * Math.sin(ang);
  return out.set(x, y, z);
}

function fairingNormal(s, t, out) {
  const r = fairRadius(t);
  const ang = (s - 0.5) * FAIR.ang;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const dr = -0.058 * 0.55;
  const dsx = 0;
  const dsy = r * ca * FAIR.ang;
  const dsz = r * sa * FAIR.ang;
  const dtx = FAIR.span;
  const dty = 0.07 + 0.028 * Math.PI * Math.cos(t * Math.PI) + dr * sa;
  const dtz = 0.3 * t - dr * ca;
  // ∂P/∂s × ∂P/∂t. At the nose this points forward (−z), out of the solid.
  out.set(dsy * dtz - dsz * dty, dsz * dtx - dsx * dtz, dsx * dty - dsy * dtx);
  if (out.lengthSq() < 1e-12) return out.set(0, 0, -1);
  return out.normalize();
}

export function createFairingPart() {
  const painted = makePainted('fairing', { color: 0x2a2a28, metalness: 0.08, roughness: 0.46, clearcoat: 0.85, bead: false });
  const group = new THREE.Group();
  group.name = 'yt-fairing';
  const geo = buildShell(fairingPoint, fairingNormal, 40, 36, FAIR.thick);
  const pick = mountMesh(group, geo, painted.mat);
  const mid = fairingPoint(0.5, 0.5, new THREE.Vector3());
  addTable(group, 0, FAIR.y - 0.12, mid.z + 0.04, 0.42, 0.22);
  group.visible = false;
  return {
    id: 'fairing',
    kind: 'raster',
    // Passes wrap the leading edge so the probe axis follows the normal
    // from flank to crest to flank. The span is the cross-track.
    along: 's',
    lengthS: measureLength(fairingPoint, 's'),
    lengthT: measureLength(fairingPoint, 't'),
    edge: 0.006,
    swath: 0.045,
    lift: 0.035,
    maxPasses: 4,
    point: fairingPoint,
    normal: fairingNormal,
    group,
    pick,
    uniforms: painted.uniforms,
    ownsGroup: true,
    presets: {
      all: { s0: 0, s1: 1, t0: 0, t1: 1 },
      center: { s0: 0.02, s1: 0.98, t0: 0.3, t1: 0.7 },
      edge: { s0: 0.04, s1: 0.96, t0: 0, t1: 0.32 },
    },
    defaultPreset: 'center',
    shot: { az: 0.95, el: 0.42, radius: 0.26, fov: 30 },
    focus(out = new THREE.Vector3()) {
      return fairingPoint(0.5, 0.5, out);
    },
  };
}

function panelNormal(s, t, out) {
  const th = (s - 0.5) * P.THETA;
  const R = radiusAt(t);
  const dR = P.R0 * P.TAPER;
  const q = 2 * t - 1;
  const sth = Math.sin(th);
  const cth = Math.cos(th);
  const dsx = R * cth * P.THETA;
  const dsy = -R * sth * P.THETA;
  const dsz = 0;
  const dtx = dR * sth;
  const dty = dR * cth - dR - 4 * P.BOW * q;
  const dtz = P.LZ;
  out.set(dty * dsz - dtz * dsy, dtz * dsx - dtx * dsz, dtx * dsy - dty * dsx);
  if (out.lengthSq() < 1e-12) return out.set(0, 1, 0);
  return out.normalize();
}

export function createPanelPart(panel) {
  const point = (s, t, out) => surfacePoint(s, t, out);
  const normal = (s, t, out) => panelNormal(s, t, out);
  return {
    id: 'panel',
    kind: 'raster',
    along: 's',
    lengthS: P.W0,
    lengthT: P.LZ,
    edge: 0.028,
    swath: 0.07,
    lift: 0.06,
    maxPasses: 8,
    point,
    normal,
    blocked(s, t) {
      const X = (s - 0.5) * P.W0;
      const Y = (t - 0.5) * P.LZ;
      return holeLevel(X, Y, 0.02) < 1;
    },
    group: panel.group,
    pick: panel.skinTop,
    uniforms: panel.uniforms,
    ownsGroup: false,
    presets: {
      all: { s0: 0, s1: 1, t0: 0, t1: 1 },
      center: { s0: 0.3, s1: 0.7, t0: 0.28, t1: 0.72 },
      edge: { s0: 0, s1: 0.22, t0: 0.08, t1: 0.92 },
    },
    defaultPreset: 'center',
    shot: { az: 0.62, el: 0.48, radius: 0.62, fov: 30 },
    focus(out = new THREE.Vector3()) {
      return surfacePoint(0.5, 0.5, out);
    },
  };
}
