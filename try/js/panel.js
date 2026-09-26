import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, fbm, smoothstep, clamp, lerp } from './util.js';
import { FX, GOLD_LIN, patchMaterial, REVEAL_X } from './fx.js';

/*
 * Demo geometry: a doubly curved, tapered composite fuselage panel with a
 * window cutout and four hat stringers on the inner side. All dimensions in
 * metres. Surface parameters: s along the arc (world X), t along the length
 * (world Z). "Metric" coordinates X/Y are nominal arc length / length.
 */
export const P = {
  R0: 1.3,
  THETA: 0.84,
  LZ: 0.8,
  TAPER: 0.1,
  BOW: 0.02,
  Y0: 0.93,
  T: 0.012,
  hole: { a: 0.145, b: 0.1, n: 4.2 },
  stringers: [-0.44, -0.22, 0.22, 0.44],
};
P.W0 = P.R0 * P.THETA;

export const HAT = { flange: 0.05, webIn: 0.0245, h: 0.036 };

export const ZONES = { cols: 'ABCDEF', rows: 4 };

export const INDICATIONS = [
  { id: '01', X: 0.33, Y: 0.19, ring: 0.05, kind: 'impact' },
  { id: '02', X: -0.2575, Y: -0.185, ring: 0.078, kind: 'foot' },
];

export const toMetric = (s, t) => [(s - 0.5) * P.W0, (t - 0.5) * P.LZ];
export const fromMetric = (X, Y) => [X / P.W0 + 0.5, Y / P.LZ + 0.5];

export function zoneOf(X, Y) {
  const col = clamp(Math.floor((X + P.W0 / 2) / (P.W0 / ZONES.cols.length)), 0, ZONES.cols.length - 1);
  const row = clamp(Math.floor((Y + P.LZ / 2) / (P.LZ / ZONES.rows)), 0, ZONES.rows - 1);
  return ZONES.cols[col] + (row + 1);
}

export const radiusAt = (t) => P.R0 * (1 + P.TAPER * (t - 0.5));

export function surfacePoint(s, t, out = new THREE.Vector3()) {
  const th = (s - 0.5) * P.THETA;
  const R = radiusAt(t);
  const q = 2 * t - 1;
  return out.set(R * Math.sin(th), P.Y0 + R * Math.cos(th) - R - P.BOW * q * q, (t - 0.5) * P.LZ);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export function surfaceNormal(s, t, out = new THREE.Vector3()) {
  const e = 1e-4;
  surfacePoint(s, t, _a);
  surfacePoint(s + e, t, _b).sub(_a);
  surfacePoint(s, t + e, _c).sub(_a);
  return out.crossVectors(_c, _b).normalize();
}

/** Unit tangent along the arc (dP/ds). */
export function surfaceTangentS(s, t, out = new THREE.Vector3()) {
  const e = 1e-4;
  surfacePoint(s + e, t, out);
  surfacePoint(s - e, t, _a);
  return out.sub(_a).normalize();
}

/** Superellipse level of the window: < 1 inside, > 1 outside. */
export function holeLevel(X, Y, grow = 0) {
  const { a, b, n } = P.hole;
  return Math.pow(Math.pow(Math.abs(X) / (a + grow), n) + Math.pow(Math.abs(Y) / (b + grow), n), 1 / n);
}

export function holeRadius(phi, grow = 0) {
  const { a, b, n } = P.hole;
  const c = Math.abs(Math.cos(phi)) / (a + grow);
  const s = Math.abs(Math.sin(phi)) / (b + grow);
  return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}

/** Half-width (along X) of the grown window at a given Y, 0 if the line misses it. */
export function holeHalfWidthAt(Y, grow = 0) {
  const { a, b, n } = P.hole;
  const r = Math.abs(Y) / (b + grow);
  if (r >= 1) return 0;
  return (a + grow) * Math.pow(1 - Math.pow(r, n), 1 / n);
}

/* ------------------------------------------------------------------ */
/* Simulated C-scan field (single source of truth for shader, A-scan,  */
/* and report thumbnail).                                              */
/* ------------------------------------------------------------------ */

export const KIND = { HOLE: 0, SOUND: 1, FOOT: 2, DOUBLER: 3, IND1: 4, IND2: 5 };

export function buildField(w, h) {
  const n1 = makeNoise2D(11);
  const n2 = makeNoise2D(23);
  const n3 = makeNoise2D(37);
  const val = new Float32Array(w * h);
  const kind = new Uint8Array(w * h);
  const rgba = new Uint8Array(w * h * 4);
  const [i1, i2] = INDICATIONS;
  const ca = Math.cos(0.6);
  const sa = Math.sin(0.6);

  for (let y = 0; y < h; y++) {
    const t = (y + 0.5) / h;
    const Y = (t - 0.5) * P.LZ;
    for (let x = 0; x < w; x++) {
      const s = (x + 0.5) / w;
      const X = (s - 0.5) * P.W0;
      const idx = y * w + x;
      const o = idx * 4;
      if (holeLevel(X, Y) < 1) {
        kind[idx] = KIND.HOLE;
        rgba[o + 3] = 0;
        continue;
      }
      let v = 0.47;
      let k = KIND.SOUND;

      const plies = Math.floor(clamp((Math.abs(Y) - 0.24) / 0.055, 0, 2));
      v -= plies * 0.022;

      const lvlD = holeLevel(X, Y, 0.045);
      if (lvlD < 1) {
        v -= 0.09 * smoothstep(1.0, 0.975, lvlD);
        k = KIND.DOUBLER;
      }

      for (let j = 0; j < P.stringers.length; j++) {
        const d = Math.abs(X - P.stringers[j]);
        if (d < HAT.flange + 0.005 && d > HAT.webIn - 0.005) {
          const e = smoothstep(HAT.webIn - 0.004, HAT.webIn + 0.002, d) * (1 - smoothstep(HAT.flange - 0.002, HAT.flange + 0.004, d));
          v -= 0.2 * e;
          if (e > 0.5) k = KIND.FOOT;
        }
      }

      v += (fbm(n1, X * 13 + 3.1, Y * 13 + 7.7, 3) - 0.5) * 0.1;
      v += (n2(X * 110, Y * 110) - 0.5) * 0.04;

      // Indication 01: impact-like, two-lobed delamination in a bay.
      const dx = X - i1.X;
      const dy = Y - i1.Y;
      let g = 0;
      if (dx * dx + dy * dy < 0.0036) {
        const lx = dx * ca + dy * sa;
        const ly = -dx * sa + dy * ca;
        const ang = Math.atan2(ly, lx);
        const wob = 1 + 0.4 * (n3(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6 + 5) - 0.5);
        const e1 = Math.hypot((lx - 0.011) / 0.021, ly / 0.016);
        const e2 = Math.hypot((lx + 0.012) / 0.019, (ly - 0.003) / 0.015);
        const core = Math.min(e1, e2) / wob;
        const halo = Math.hypot(lx / 0.034, ly / 0.026) / wob;
        const hHalo = 1 - smoothstep(0.75, 1.1, halo);
        const hCore = 1 - smoothstep(0.8, 1.05, core);
        v = lerp(v, 0.74 + (n2(X * 70, Y * 70) - 0.5) * 0.08, hHalo);
        v = lerp(v, 0.97, hCore);
        g = Math.max(hHalo, hCore);
        if (g > 0.35) k = KIND.IND1;
      }

      // Indication 02: along the outer foot of the left inner stringer.
      const qx = (X - i2.X) / 0.017;
      const qy = (Y - i2.Y) / 0.062;
      let g2 = 0;
      if (Math.abs(qx) < 1.6 && Math.abs(qy) < 1.4) {
        const wob2 = 1 + 0.45 * (n3(X * 45 + 1, Y * 45 + 3) - 0.5);
        const shape = Math.pow(Math.pow(Math.abs(qx), 3) + Math.pow(Math.abs(qy), 3), 1 / 3) / wob2;
        g2 = 1 - smoothstep(0.78, 1.05, shape);
        v = lerp(v, 0.9 + (n2(X * 90, Y * 60) - 0.5) * 0.08, g2);
        if (g2 > 0.35) k = KIND.IND2;
      }

      v = clamp(v, 0.02, 1);
      val[idx] = v;
      kind[idx] = k;
      rgba[o] = Math.round(v * 255);
      rgba[o + 1] = g > 0.35 ? 128 : g2 > 0.35 ? 255 : 0;
      rgba[o + 2] = k * 40;
      rgba[o + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;

  function sample(s, t) {
    const x = clamp(Math.floor(s * w), 0, w - 1);
    const y = clamp(Math.floor(t * h), 0, h - 1);
    const i = y * w + x;
    return { value: val[i], kind: kind[i] };
  }

  return { w, h, val, kind, texture: tex, sample };
}

/* Gold C-scan ramp (sRGB stops). Shared by GLSL (converted to linear) and canvas. */
export const RAMP = [
  [0.0, '#090806'],
  [0.22, '#2a230f'],
  [0.4, '#5f4f1d'],
  [0.58, '#a08a36'],
  [0.76, '#dcbd48'],
  [0.9, '#f3d56a'],
  [1.0, '#fff4d2'],
];

export function rampRGB(v) {
  const c = new THREE.Color();
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0] || i === RAMP.length - 1) {
      const [p0, h0] = RAMP[i - 1];
      const [p1, h1] = RAMP[i];
      const k = clamp((v - p0) / (p1 - p0), 0, 1);
      c.set(h0).lerp(new THREE.Color(h1), k);
      return c;
    }
  }
  return c.set(RAMP[RAMP.length - 1][1]);
}

/* ------------------------------------------------------------------ */
/* Carbon weave textures (procedural 2/2 twill).                       */
/* ------------------------------------------------------------------ */

function makeWeave(size = 256) {
  const tows = 4;
  const cell = size / tows;
  const H = new Float32Array(size * size);
  const warpAt = new Uint8Array(size * size);
  const over = (i, j) => ((((i + j) % 4) + 4) % 4) < 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = Math.floor(x / cell);
      const j = Math.floor(y / cell);
      const u = ((x % cell) + 0.5) / cell;
      const v = ((y % cell) + 0.5) / cell;
      const warp = over(i, j);
      const across = warp ? v : u;
      const along = warp ? u : v;
      let hgt = Math.sqrt(Math.max(0, Math.sin(Math.PI * across)));
      const prevOver = warp ? over(i - 1, j) : !over(i, j - 1);
      const nextOver = warp ? over(i + 1, j) : !over(i, j + 1);
      if (!prevOver) hgt *= 0.7 + 0.3 * smoothstep(0.0, 0.3, along);
      if (!nextOver) hgt *= 0.7 + 0.3 * smoothstep(1.0, 0.7, along);
      hgt += 0.035 * Math.sin((warp ? y : x) * 1.9);
      H[y * size + x] = hgt;
      warpAt[y * size + x] = warp ? 1 : 0;
    }
  }
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  };
  const cn = mk();
  const ca = mk();
  const cc = mk();
  const gn = cn.getContext('2d');
  const ga = ca.getContext('2d');
  const gc = cc.getContext('2d');
  const dn = gn.createImageData(size, size);
  const da = ga.createImageData(size, size);
  const dc = gc.createImageData(size, size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const nx = (at(x - 1, y) - at(x + 1, y)) * 2.2;
      const ny = (at(x, y - 1) - at(x, y + 1)) * 2.2;
      const len = Math.hypot(nx, ny, 1);
      dn.data[o] = (nx / len) * 127.5 + 127.5;
      dn.data[o + 1] = (ny / len) * 127.5 + 127.5;
      dn.data[o + 2] = (1 / len) * 127.5 + 127.5;
      dn.data[o + 3] = 255;
      const warp = warpAt[y * size + x];
      da.data[o] = warp ? 255 : 128;
      da.data[o + 1] = warp ? 128 : 255;
      da.data[o + 2] = 255;
      da.data[o + 3] = 255;
      const hgt = H[y * size + x];
      const base = (warp ? 232 : 214) * (0.86 + 0.14 * hgt);
      dc.data[o] = base;
      dc.data[o + 1] = base * 0.985;
      dc.data[o + 2] = base * 0.95;
      dc.data[o + 3] = 255;
    }
  }
  gn.putImageData(dn, 0, 0);
  ga.putImageData(da, 0, 0);
  gc.putImageData(dc, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { normal: tex(cn, false), aniso: tex(ca, false), color: tex(cc, true) };
}

/* ------------------------------------------------------------------ */
/* Geometry builders.                                                  */
/* ------------------------------------------------------------------ */

function outerPerimeter(NP) {
  const hw = P.W0 / 2;
  const hh = P.LZ / 2;
  const nX = Math.round((NP * P.W0) / (2 * (P.W0 + P.LZ)));
  const nY = NP / 2 - nX;
  const pts = [];
  const corners = [];
  corners.push(pts.length);
  for (let i = 0; i < nX; i++) pts.push([-hw + (P.W0 * i) / nX, -hh]);
  corners.push(pts.length);
  for (let i = 0; i < nY; i++) pts.push([hw, -hh + (P.LZ * i) / nY]);
  corners.push(pts.length);
  for (let i = 0; i < nX; i++) pts.push([hw - (P.W0 * i) / nX, hh]);
  corners.push(pts.length);
  for (let i = 0; i < nY; i++) pts.push([-hw, hh - (P.LZ * i) / nY]);
  return { pts, corners };
}

function buildSkin(NP = 288, NR = 40) {
  const { pts: outer, corners } = outerPerimeter(NP);
  const inner = outer.map(([X, Y]) => {
    const phi = Math.atan2(Y, X);
    const r = holeRadius(phi);
    return [r * Math.cos(phi), r * Math.sin(phi)];
  });
  const rows = NR + 1;
  const count = rows * NP;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const posB = new Float32Array(count * 3);
  const norB = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const q = i / NR;
    for (let j = 0; j < NP; j++) {
      const X = lerp(inner[j][0], outer[j][0], q);
      const Y = lerp(inner[j][1], outer[j][1], q);
      const [s, t] = fromMetric(X, Y);
      surfacePoint(s, t, p);
      surfaceNormal(s, t, n);
      const k = i * NP + j;
      pos.set([p.x, p.y, p.z], k * 3);
      nor.set([n.x, n.y, n.z], k * 3);
      uv.set([s, t], k * 2);
      posB.set([p.x - n.x * P.T, p.y - n.y * P.T, p.z - n.z * P.T], k * 3);
      norB.set([-n.x, -n.y, -n.z], k * 3);
    }
  }
  const idx = [];
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NP; j++) {
      const j1 = (j + 1) % NP;
      const a = i * NP + j;
      const b = (i + 1) * NP + j;
      const c = (i + 1) * NP + j1;
      const d = i * NP + j1;
      idx.push(a, b, c, a, c, d);
    }
  }
  // Orient triangles so their winding agrees with the upward normal.
  const va = new THREE.Vector3().fromArray(pos, idx[0] * 3);
  const vb = new THREE.Vector3().fromArray(pos, idx[1] * 3);
  const vc = new THREE.Vector3().fromArray(pos, idx[2] * 3);
  const fn = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va));
  const flip = fn.dot(new THREE.Vector3().fromArray(nor, idx[0] * 3)) < 0;
  const top = [];
  const bot = [];
  for (let k = 0; k < idx.length; k += 3) {
    if (flip) {
      top.push(idx[k], idx[k + 2], idx[k + 1]);
      bot.push(idx[k], idx[k + 1], idx[k + 2]);
    } else {
      top.push(idx[k], idx[k + 1], idx[k + 2]);
      bot.push(idx[k], idx[k + 2], idx[k + 1]);
    }
  }
  const gTop = new THREE.BufferGeometry();
  gTop.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  gTop.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  gTop.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  gTop.setIndex(top);
  const gBot = new THREE.BufferGeometry();
  gBot.setAttribute('position', new THREE.BufferAttribute(posB, 3));
  gBot.setAttribute('normal', new THREE.BufferAttribute(norB, 3));
  gBot.setAttribute('uv', new THREE.BufferAttribute(uv.slice(), 2));
  gBot.setIndex(bot);

  // Walls: outer boundary (one strip per side, split normals) + window edge.
  const wp = [];
  const wn = [];
  const wuv = [];
  const wi = [];
  const center = surfacePoint(0.5, 0.5, new THREE.Vector3());
  const addStrip = (ring, from, to, inward, uOffset) => {
    const base = wp.length / 3;
    const cnt = to - from + 1;
    const tmp = new THREE.Vector3();
    for (let m = 0; m < cnt; m++) {
      const j = (from + m) % NP;
      const jPrev = (from + Math.max(m - 1, 0)) % NP;
      const jNext = (from + Math.min(m + 1, cnt - 1)) % NP;
      const k = ring * NP + j;
      const pt = new THREE.Vector3().fromArray(pos, k * 3);
      const nn = new THREE.Vector3().fromArray(nor, k * 3);
      const tan = new THREE.Vector3().fromArray(pos, (ring * NP + jNext) * 3).sub(tmp.fromArray(pos, (ring * NP + jPrev) * 3)).normalize();
      const wnrm = new THREE.Vector3().crossVectors(nn, tan).normalize();
      const away = new THREE.Vector3().subVectors(pt, center);
      if ((wnrm.dot(away) < 0) !== inward) wnrm.negate();
      const u = uOffset + m / Math.max(cnt - 1, 1);
      wp.push(pt.x, pt.y, pt.z, pt.x - nn.x * P.T, pt.y - nn.y * P.T, pt.z - nn.z * P.T);
      wn.push(wnrm.x, wnrm.y, wnrm.z, wnrm.x, wnrm.y, wnrm.z);
      wuv.push(u, 0, u, 1);
    }
    for (let m = 0; m < cnt - 1; m++) {
      const a = base + m * 2;
      const b = a + 1;
      const c = a + 3;
      const d = a + 2;
      const A = new THREE.Vector3().fromArray(wp, a * 3);
      const B = new THREE.Vector3().fromArray(wp, b * 3);
      const C = new THREE.Vector3().fromArray(wp, c * 3);
      const nrm = new THREE.Vector3().fromArray(wn, a * 3);
      const f = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      if (f.dot(nrm) >= 0) wi.push(a, b, c, a, c, d);
      else wi.push(a, c, b, a, d, c);
    }
  };
  for (let side = 0; side < 4; side++) {
    const from = corners[side];
    const to = side === 3 ? NP : corners[side + 1];
    addStrip(NR, from, to, false, side);
  }
  addStrip(0, 0, NP, true, 0);
  const gWall = new THREE.BufferGeometry();
  gWall.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  gWall.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
  gWall.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  gWall.setIndex(wi);

  return { gTop, gBot, gWall };
}

const HAT_PROFILE = [
  [-0.05, 0], [-0.05, 0.003], [-0.0275, 0.003], [-0.0175, 0.036], [0.0175, 0.036], [0.0275, 0.003],
  [0.05, 0.003], [0.05, 0], [0.0245, 0], [0.015, 0.033], [-0.015, 0.033], [-0.0245, 0],
];

function buildStringer(Xc, NT = 56) {
  const [s] = fromMetric(Xc, 0);
  const t0 = 0.012;
  const t1 = 0.988;
  const prof = HAT_PROFILE;
  const M = prof.length;
  const frames = [];
  const o = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const lat = new THREE.Vector3();
  for (let k = 0; k < NT; k++) {
    const t = lerp(t0, t1, k / (NT - 1));
    surfacePoint(s, t, o);
    surfaceNormal(s, t, nrm);
    surfaceTangentS(s, t, lat);
    o.addScaledVector(nrm, -P.T);
    const R = radiusAt(t);
    const ring = prof.map(([l, d]) => {
      const dd = d + (l * l) / (2 * R);
      return new THREE.Vector3().copy(o).addScaledVector(lat, l).addScaledVector(nrm, -dd);
    });
    frames.push({ ring, lat: lat.clone(), dp: nrm.clone().negate() });
  }
  const pos = [];
  const nor = [];
  const uv = [];
  const ind = [];
  for (let m = 0; m < M; m++) {
    const m1 = (m + 1) % M;
    const dl = prof[m1][0] - prof[m][0];
    const dd = prof[m1][1] - prof[m][1];
    const len = Math.hypot(dl, dd) || 1;
    const n2 = [-dd / len, dl / len];
    const base = pos.length / 3;
    for (let k = 0; k < NT; k++) {
      const f = frames[k];
      const nn = new THREE.Vector3().copy(f.lat).multiplyScalar(n2[0]).addScaledVector(f.dp, n2[1]).normalize();
      for (const pi of [m, m1]) {
        const v = f.ring[pi];
        pos.push(v.x, v.y, v.z);
        nor.push(nn.x, nn.y, nn.z);
        uv.push(k / (NT - 1), pi === m ? 0 : 1);
      }
    }
    for (let k = 0; k < NT - 1; k++) {
      const a = base + k * 2;
      ind.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  // End caps.
  const tris = THREE.ShapeUtils.triangulateShape(prof.map(([l, d]) => new THREE.Vector2(l, d)), []);
  for (const k of [0, NT - 1]) {
    const f = frames[k];
    const base = pos.length / 3;
    const tangent = new THREE.Vector3().subVectors(frames[Math.min(k + 1, NT - 1)].ring[0], frames[Math.max(k - 1, 0)].ring[0]).normalize();
    const cn = k === 0 ? tangent.clone().negate() : tangent;
    for (const v of f.ring) {
      pos.push(v.x, v.y, v.z);
      nor.push(cn.x, cn.y, cn.z);
      uv.push(0, 0);
    }
    for (const tri of tris) {
      const A = f.ring[tri[0]];
      const B = f.ring[tri[1]];
      const C = f.ring[tri[2]];
      const fn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      if (fn.dot(cn) >= 0) ind.push(base + tri[0], base + tri[1], base + tri[2]);
      else ind.push(base + tri[0], base + tri[2], base + tri[1]);
    }
  }
  // Fix side winding against normals.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const fixed = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i < ind.length; i += 3) {
    A.fromArray(pos, ind[i] * 3);
    B.fromArray(pos, ind[i + 1] * 3);
    C.fromArray(pos, ind[i + 2] * 3);
    N.fromArray(nor, ind[i] * 3);
    const f = B.sub(A).cross(C.sub(A));
    if (f.dot(N) >= 0) fixed.push(ind[i], ind[i + 1], ind[i + 2]);
    else fixed.push(ind[i], ind[i + 2], ind[i + 1]);
  }
  g.setIndex(fixed);
  return g;
}

function buildCradle(tc) {
  const pts = [];
  const N = 72;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    surfacePoint(s, tc, p);
    surfaceNormal(s, tc, n);
    pts.push([p.x - n.x * (P.T + 0.002), p.y - n.y * (P.T + 0.002)]);
  }
  const notchX = P.stringers.map((X) => {
    const [s] = fromMetric(X, 0);
    return surfacePoint(s, tc, new THREE.Vector3()).x;
  });
  const yAt = (x) => {
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const k = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return lerp(pts[i - 1][1], pts[i][1], k);
      }
    }
    return pts[pts.length - 1][1];
  };
  const halfW = 0.058;
  const depth = HAT.h + 0.012;
  const contour = [];
  const xs = pts.map((q) => q[0]);
  const xMin = xs[0] - 0.025;
  const xMax = xs[xs.length - 1] + 0.025;
  const bottom = 0.7;
  contour.push([xMin, bottom], [xMin, pts[0][1]]);
  let skipUntil = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0];
    if (x < skipUntil) continue;
    const notch = notchX.find((nx) => x > nx - halfW && x < nx + halfW);
    if (notch !== undefined) {
      const xa = notch - halfW;
      const xb = notch + halfW;
      const ya = yAt(xa);
      const yb = yAt(xb);
      contour.push([xa, ya], [xa + 0.004, ya - depth], [xb - 0.004, yb - depth], [xb, yb]);
      skipUntil = xb;
      continue;
    }
    contour.push(pts[i]);
  }
  contour.push([xMax, pts[pts.length - 1][1]], [xMax, bottom]);
  const shape = new THREE.Shape(contour.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.026,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.translate(0, 0, surfacePoint(0.5, tc, new THREE.Vector3()).z - 0.013);
  return toCreasedNormals(g, Math.PI / 5);
}

/* ------------------------------------------------------------------ */
/* Materials.                                                          */
/* ------------------------------------------------------------------ */

function linearRampUniform() {
  return RAMP.map(([, hex]) => new THREE.Color(hex).convertSRGBToLinear());
}

export function createPanel({ fieldW = 512, fieldH = 376, anisotropy = 4 } = {}) {
  const group = new THREE.Group();
  group.name = 'panel';
  const field = buildField(fieldW, fieldH);
  const weave = makeWeave(256);
  [weave.normal, weave.aniso, weave.color].forEach((t) => (t.anisotropy = anisotropy));
  const rep = new THREE.Vector2(P.W0 / 0.03, P.LZ / 0.03);
  [weave.normal, weave.aniso, weave.color].forEach((t) => t.repeat.copy(rep));

  const coverPlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  coverPlaceholder.needsUpdate = true;

  const U = {
    uField: { value: field.texture },
    uCover: { value: coverPlaceholder },
    uMetric: { value: new THREE.Vector2(P.W0, P.LZ) },
    uIso: { value: 0 },
    uIsoSweep: { value: 0 },
    uCscan: { value: 0 },
    uCscanGain: { value: 2.3 },
    uScanNow: { value: 0 },
    uGlow: { value: 0 },
    uZones: { value: 0 },
    uMarks: { value: 0 },
    uInd0: { value: new THREE.Vector4(INDICATIONS[0].X, INDICATIONS[0].Y, INDICATIONS[0].ring, 0) },
    uInd1: { value: new THREE.Vector4(INDICATIONS[1].X, INDICATIONS[1].Y, INDICATIONS[1].ring, 0) },
    uProbe: { value: new THREE.Vector3(0, 0, 0) },
    uRampC: { value: linearRampUniform() },
    uGold: { value: GOLD_LIN.clone() },
  };

  const rampGLSL = RAMP.map(([p], i) => `if (v <= ${p.toFixed(3)}) return mix(uRampC[${Math.max(i - 1, 0)}], uRampC[${i}], ${i === 0 ? '1.0' : `(v - ${RAMP[i - 1][0].toFixed(3)}) / ${(p - RAMP[i - 1][0]).toFixed(3)}`});`).join('\n');

  const top = new THREE.MeshPhysicalMaterial({
    color: 0x232322,
    map: weave.color,
    roughness: 0.42,
    metalness: 0.0,
    normalMap: weave.normal,
    normalScale: new THREE.Vector2(0.17, 0.17),
    clearcoat: 1.0,
    clearcoatRoughness: 0.15,
    anisotropy: 0.5,
    anisotropyMap: weave.aniso,
    envMapIntensity: 1.0,
  });
  patchMaterial(
    top,
    {
      uniforms: U,
      fragPars: `
        uniform sampler2D uField; uniform sampler2D uCover; uniform vec2 uMetric;
        uniform float uIso; uniform float uIsoSweep; uniform float uCscan; uniform float uCscanGain;
        uniform float uScanNow; uniform float uGlow; uniform float uZones; uniform float uMarks;
        uniform vec4 uInd0; uniform vec4 uInd1; uniform vec3 uProbe; uniform vec3 uRampC[${RAMP.length}]; uniform vec3 uGold;
        vec3 goldRamp(float v) {
          ${rampGLSL}
          return uRampC[${RAMP.length - 1}];
        }
        float fxGrid(vec2 p, vec2 cells, float w) {
          vec2 q = p * cells;
          vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5));
          return 1.0 - smoothstep(0.0, w, min(g.x, g.y));
        }
        float fxRing(vec2 pm, vec4 ind, float w) {
          float d = abs(length(pm - ind.xy) - ind.z);
          return 1.0 - smoothstep(w * 0.4, w, d);
        }
      `,
      fragStart: `
        vec2 pu = vFxUv;
        vec2 pm = (pu - 0.5) * uMetric;
        float iso = fxGrid(pu, vec2(26.0, 19.0), 1.1);
        vec2 edgeD = 0.5 * uMetric - abs(pm);
        float outline = 1.0 - smoothstep(0.0015, 0.0045, min(edgeD.x, edgeD.y));
        float fxFront = uPartReveal - (vFxW.x * 0.86 + 0.5);
        float wire = (uPartRevealOn > 0.5 && fxFront < 0.0) ? 1.0 : 0.0;
        if (wire > 0.5 && max(iso * 0.8, outline) < 0.3) discard;
      `,
      fragColor: `
        vec4 fxCov = texture2D(uCover, pu);
        vec4 fxFld = texture2D(uField, pu);
        float covered = clamp(fxCov.r, 0.0, 1.0) * uCscan * (1.0 - wire);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.22, covered);
        diffuseColor.rgb *= (1.0 - wire);
      `,
      fragEmissive: `
        vec3 fxLate = vec3(0.0);
        float val = fxFld.r * (0.955 + 0.09 * fxCov.b);
        vec3 cs = goldRamp(clamp(val, 0.0, 1.0));
        float fresh = covered * uGlow * clamp(1.0 - (uScanNow - fxCov.g) * 16.0, 0.0, 1.0);
        float hot = smoothstep(0.72, 0.95, val);
        fxLate += cs * covered * uCscanGain * (1.0 + 0.9 * fresh + 1.6 * hot);
        float isoOn = uIso * (1.0 - smoothstep(uIsoSweep - 0.02, uIsoSweep, pu.x)) * (1.0 - covered * 0.85);
        fxLate += uGold * (iso * (isoOn * 0.32 + wire * 1.2) + outline * (wire * 2.2 + isoOn * 1.2));
        fxLate += vec3(1.0, 0.66, 0.16) * 3.4 * uPartRevealOn * (1.0 - smoothstep(0.0, 0.012, abs(fxFront)));
        float zg = fxGrid(pu, vec2(6.0, 4.0), 1.0);
        fxLate += uGold * zg * uZones * 0.55;
        float pulse = 0.75 + 0.25 * sin(uTime * 3.2);
        fxLate += uGold * uMarks * pulse * 3.0 * (fxRing(pm, uInd0, 0.0035) + fxRing(pm, uInd1, 0.0035));
        float pd = length(pm - uProbe.xy);
        float ph = fract(uTime * 1.7);
        float pring = (1.0 - smoothstep(0.001, 0.0035, abs(pd - ph * 0.07))) * (1.0 - ph);
        fxLate += uGold * uProbe.z * (pring * 1.4 + exp(-pd * pd / 0.00018) * 0.7);
      `,
      fragMaterial: `
        material.clearcoat *= 1.0 - 0.72 * covered;
        material.roughness = mix(material.roughness, 0.7, covered * 0.6);
      `,
      fragFinal: `outgoingLight += fxLate;`,
    },
    'panel-top'
  );

  const bottomMat = patchMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x151514,
      map: weave.color,
      roughness: 0.62,
      normalMap: weave.normal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      anisotropy: 0.5,
      anisotropyMap: weave.aniso,
    }),
    REVEAL_X,
    'panel-bottom'
  );

  const edgeMat = patchMaterial(
    new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.66, metalness: 0.0 }),
    {
      fragStart: REVEAL_X.fragStart,
      fragColor: `diffuseColor.rgb *= 0.72 + 0.28 * step(0.5, fract(vFxUv.y * 7.0));`,
      fragEmissive: REVEAL_X.fragEmissive,
    },
    'panel-edge'
  );

  const stringerMat = patchMaterial(
    new THREE.MeshPhysicalMaterial({ color: 0x171716, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
    REVEAL_X,
    'panel-stringer'
  );

  const fixtureMat = patchMaterial(
    new THREE.MeshStandardMaterial({ color: 0x2b2a28, metalness: 0.6, roughness: 0.42 }),
    REVEAL_X,
    'fixture'
  );

  const { gTop, gBot, gWall } = buildSkin();
  const skinTop = new THREE.Mesh(gTop, top);
  const skinBot = new THREE.Mesh(gBot, bottomMat);
  const skinWall = new THREE.Mesh(gWall, edgeMat);
  [skinTop, skinBot, skinWall].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });
  for (const X of P.stringers) {
    const m = new THREE.Mesh(buildStringer(X), stringerMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  const fixture = new THREE.Group();
  for (const tc of [0.13, 0.87]) {
    const cr = new THREE.Mesh(buildCradle(tc), fixtureMat);
    cr.castShadow = true;
    cr.receiveShadow = true;
    fixture.add(cr);
    const z = surfacePoint(0.5, tc, new THREE.Vector3()).z;
    for (const x of [-0.34, 0.34]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.67, 0.042), fixtureMat);
      leg.position.set(x, 0.03 + 0.335, z);
      leg.castShadow = true;
      leg.receiveShadow = true;
      fixture.add(leg);
    }
  }
  for (const x of [-0.34, 0.34]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.78), fixtureMat);
    rail.position.set(x, 0.02, 0);
    rail.castShadow = true;
    rail.receiveShadow = true;
    fixture.add(rail);
  }
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.03, 0.036), fixtureMat);
  brace.position.set(0, 0.3, surfacePoint(0.5, 0.13, new THREE.Vector3()).z);
  fixture.add(brace);
  const brace2 = brace.clone();
  brace2.position.z = surfacePoint(0.5, 0.87, new THREE.Vector3()).z;
  fixture.add(brace2);
  group.add(fixture);

  const indications = INDICATIONS.map((d) => {
    const [s, t] = fromMetric(d.X, d.Y);
    return {
      ...d,
      s,
      t,
      zone: zoneOf(d.X, d.Y),
      pos: surfacePoint(s, t, new THREE.Vector3()),
      normal: surfaceNormal(s, t, new THREE.Vector3()),
    };
  });

  return { group, field, uniforms: U, materials: { top }, indications, skinTop };
}
