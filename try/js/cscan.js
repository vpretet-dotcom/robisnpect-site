import * as THREE from 'three';
import { P, fromMetric } from './panel.js';
import { SCAN } from './trajectory.js';

/*
 * Coverage map in panel UV space. Each stamp is a soft disc the size of the
 * probe swath, written with MAX blending:
 *   R = coverage, G = acquisition time (path fraction), B = per-pass gain.
 * The panel shader reveals the simulated C-scan field only where R > 0.
 */
export function createCoverage(renderer, traj, { width = 1024, maxStamps = 4096 } = {}) {
  const height = Math.round((width * P.LZ) / P.W0);
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const geo = new THREE.PlaneGeometry(1, 1);
  const aTime = new THREE.InstancedBufferAttribute(new Float32Array(maxStamps), 1);
  const aGain = new THREE.InstancedBufferAttribute(new Float32Array(maxStamps), 1);
  aTime.setUsage(THREE.DynamicDrawUsage);
  aGain.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTime', aTime);
  geo.setAttribute('aGain', aGain);
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aTime; attribute float aGain;
      varying vec2 vQ; varying float vT; varying float vG;
      void main() {
        vQ = position.xy * 2.0; vT = aTime; vG = aGain;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vQ; varying float vT; varying float vG;
      void main() {
        float r = length(vQ);
        if (r > 1.0) discard;
        float m = 1.0 - smoothstep(0.7, 1.0, r);
        float on = step(0.03, m);
        gl_FragColor = vec4(m, vT * on, vG * on, 1.0);
      }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, maxStamps);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const sx = SCAN.swath / P.W0;
  const sy = SCAN.swath / P.LZ;
  const m4 = new THREE.Matrix4();
  const gains = [];
  for (let k = 0; k < SCAN.passes; k++) gains.push(0.5 + 0.5 * Math.sin(k * 12.9898 + 4.1414) * Math.cos(k * 3.7));
  const state = {};
  let painted = 0;
  const step = 0.008;
  const prevColor = new THREE.Color();

  function clear() {
    const a = renderer.getClearAlpha();
    renderer.getClearColor(prevColor);
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevColor, a);
    painted = 0;
  }

  function flush(n) {
    if (!n) return;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aTime.needsUpdate = true;
    aGain.needsUpdate = true;
    const prevRT = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = auto;
    mesh.count = 0;
  }

  /** Paint coverage up to arc length sTarget (repaints from zero when seeking back). */
  function paintTo(sTarget) {
    sTarget = Math.min(sTarget, traj.total);
    if (sTarget < painted - 1e-4) clear();
    if (sTarget <= painted) return;
    let n = 0;
    let s = painted === 0 ? 0 : painted + step;
    for (; s <= sTarget; s += step) {
      traj.at(s, state);
      if (!state.contact) continue;
      const [u, v] = fromMetric(state.X, state.Y);
      m4.makeScale(sx, sy, 1).setPosition(u, v, 0);
      mesh.setMatrixAt(n, m4);
      aTime.array[n] = s / traj.total;
      aGain.array[n] = gains[state.pass] ?? 0.5;
      n++;
      if (n >= maxStamps) {
        flush(n);
        n = 0;
      }
    }
    flush(n);
    painted = sTarget;
  }

  clear();
  return { texture: rt.texture, paintTo, clear, get painted() { return painted; }, rt };
}

/*
 * Zone coverage in the part's (s, t) UV, with the scripted painter's stamp:
 * a soft disc of the probe footprint along the contact path, MAX
 * blended, R = coverage, G = acquisition time, B = per-pass gain.
 * The disc is sized in metres from the local surface partials, so it stays
 * round under the probe on curved and stretched parts, and it is clipped to
 * the chosen zone.
 */
/* 8 mm as in the scripted painter, closer on small footprints so the bands have no notches. */
const stampStep = (radius) => Math.min(0.008, radius * 0.4);
/*
 * Stamp profile 1 - smoothstep(0.8, 1, r): still 0.84 where two passes one
 * pitch (0.85 of the footprint) apart meet, 0.5 at COVER_RADIUS, which is
 * what counts as covered.
 */
export const COVER_RADIUS = 0.9;

const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

function passGain(k) {
  return 0.5 + 0.5 * Math.sin(k * 12.9898 + 4.1414) * Math.cos(k * 3.7);
}

/** Local metres per unit s and per unit t. */
export function surfaceScale(surface, u, v, out = { s: 1, t: 1 }) {
  const e = 1e-3;
  const u0 = Math.max(0, u - e);
  const u1 = Math.min(1, u + e);
  const v0 = Math.max(0, v - e);
  const v1 = Math.min(1, v + e);
  out.s = surface.point(u1, v, _pa).distanceTo(surface.point(u0, v, _pb)) / (u1 - u0);
  out.t = surface.point(u, v1, _pa).distanceTo(surface.point(u, v0, _pb)) / (v1 - v0);
  return out;
}

/** Calls fn(u, v, rx, ry, s, pass) for each contact stamp with arc length in [from, to]. */
export function forEachStamp(traj, surface, radius, from, to, fn) {
  const state = {};
  const sc = { s: 1, t: 1 };
  const step = stampStep(radius);
  const first = from <= 0 ? 0 : Math.ceil(from / step) * step;
  for (let s = first; s <= to + 1e-9; s += step) {
    traj.at(s, state);
    if (!state.contact) continue;
    surfaceScale(surface, state.u, state.v, sc);
    fn(state.u, state.v, radius / Math.max(sc.s, 1e-4), radius / Math.max(sc.t, 1e-4), s, state.pass);
  }
}

/** Metric-weighted coverage of the clip rect, sampled the way the painter stamps. */
export function coverageGrid(traj, surface, clip, radius) {
  const Ls = surface.lengthS || 1;
  const Lt = surface.lengthT || 1;
  const spanS = (clip.s1 - clip.s0) * Ls;
  const spanT = (clip.t1 - clip.t0) * Lt;
  const cell = Math.max(spanS, spanT) / 180;
  const nu = Math.max(8, Math.round(spanS / cell));
  const nv = Math.max(8, Math.round(spanT / cell));
  const du = (clip.s1 - clip.s0) / nu;
  const dv = (clip.t1 - clip.t0) / nv;
  const hit = new Uint8Array(nu * nv);
  forEachStamp(traj, surface, radius, 0, traj.total, (u, v, rx, ry) => {
    const rxC = rx * COVER_RADIUS;
    const ryC = ry * COVER_RADIUS;
    const i0 = Math.max(0, Math.floor((u - rxC - clip.s0) / du));
    const i1 = Math.min(nu - 1, Math.floor((u + rxC - clip.s0) / du));
    const j0 = Math.max(0, Math.floor((v - ryC - clip.t0) / dv));
    const j1 = Math.min(nv - 1, Math.floor((v + ryC - clip.t0) / dv));
    for (let j = j0; j <= j1; j++) {
      const cv = clip.t0 + (j + 0.5) * dv;
      const qy = (cv - v) / ryC;
      for (let i = i0; i <= i1; i++) {
        const cu = clip.s0 + (i + 0.5) * du;
        const qx = (cu - u) / rxC;
        if (qx * qx + qy * qy <= 1) hit[j * nu + i] = 1;
      }
    }
  });
  const sc = { s: 1, t: 1 };
  let area = 0;
  let covered = 0;
  const open = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j++) {
    const cv = clip.t0 + (j + 0.5) * dv;
    for (let i = 0; i < nu; i++) {
      const cu = clip.s0 + (i + 0.5) * du;
      if (surface.blocked?.(cu, cv)) continue;
      open[j * nu + i] = 1;
      surfaceScale(surface, cu, cv, sc);
      const w = sc.s * sc.t;
      area += w;
      if (hit[j * nu + i]) covered += w;
    }
  }
  const index = (u, v) => {
    const i = Math.floor((u - clip.s0) / du);
    const j = Math.floor((v - clip.t0) / dv);
    if (i < 0 || j < 0 || i >= nu || j >= nv) return -1;
    return j * nu + i;
  };
  return {
    nu,
    nv,
    hit,
    open,
    clip,
    area: area * du * dv,
    fraction: area > 0 ? covered / area : 0,
    covered(u, v) {
      const k = index(u, v);
      return k >= 0 && hit[k] === 1;
    },
  };
}

export function createCoverageUV(renderer, traj, { surface, clip, maxStamps = 4096 } = {}) {
  const Ls = surface.lengthS || 1;
  const Lt = surface.lengthT || 1;
  const long = Math.max(Ls, Lt);
  const width = Math.max(128, Math.round((1024 * Ls) / long));
  const height = Math.max(128, Math.round((1024 * Lt) / long));
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const geo = new THREE.PlaneGeometry(1, 1);
  const aTime = new THREE.InstancedBufferAttribute(new Float32Array(maxStamps), 1);
  const aGain = new THREE.InstancedBufferAttribute(new Float32Array(maxStamps), 1);
  aTime.setUsage(THREE.DynamicDrawUsage);
  aGain.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTime', aTime);
  geo.setAttribute('aGain', aGain);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uClip: { value: new THREE.Vector4(clip.s0, clip.t0, clip.s1, clip.t1) } },
    vertexShader: /* glsl */ `
      attribute float aTime; attribute float aGain;
      varying vec2 vQ; varying vec2 vUv; varying float vT; varying float vG;
      void main() {
        vQ = position.xy * 2.0; vT = aTime; vG = aGain;
        vec4 w = instanceMatrix * vec4(position, 1.0);
        vUv = w.xy;
        gl_Position = projectionMatrix * modelViewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec4 uClip;
      varying vec2 vQ; varying vec2 vUv; varying float vT; varying float vG;
      void main() {
        if (vUv.x < uClip.x || vUv.y < uClip.y || vUv.x > uClip.z || vUv.y > uClip.w) discard;
        float r = length(vQ);
        if (r > 1.0) discard;
        float m = 1.0 - smoothstep(0.8, 1.0, r);
        float on = step(0.03, m);
        gl_FragColor = vec4(m, vT * on, vG * on, 1.0);
      }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, maxStamps);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const radius = (surface.swath ?? 0.05) / 2;
  const m4 = new THREE.Matrix4();
  let painted = -1;
  const prevColor = new THREE.Color();

  function clear() {
    const a = renderer.getClearAlpha();
    renderer.getClearColor(prevColor);
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevColor, a);
    painted = -1;
  }

  function flush(n) {
    if (!n) return;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aTime.needsUpdate = true;
    aGain.needsUpdate = true;
    const prevRT = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = auto;
    mesh.count = 0;
  }

  function paintTo(sTarget) {
    if (!traj || !traj.total) return;
    sTarget = Math.min(sTarget, traj.total);
    if (sTarget < painted - 1e-4) clear();
    if (sTarget <= painted) return;
    let n = 0;
    forEachStamp(traj, surface, radius, painted < 0 ? 0 : painted + 1e-6, sTarget, (u, v, rx, ry, s, pass) => {
      m4.makeScale(rx * 2, ry * 2, 1).setPosition(u, v, 0);
      mesh.setMatrixAt(n, m4);
      aTime.array[n] = s / traj.total;
      aGain.array[n] = passGain(pass || 0);
      n++;
      if (n >= maxStamps) {
        flush(n);
        n = 0;
      }
    });
    flush(n);
    painted = sTarget;
  }

  function dispose() {
    rt.dispose();
    geo.dispose();
    mat.dispose();
  }

  clear();
  return { texture: rt.texture, paintTo, clear, dispose, radius, get painted() { return Math.max(0, painted); }, rt };
}
