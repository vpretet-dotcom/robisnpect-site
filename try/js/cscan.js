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
 * Coverage in parametric (s, t) UV for a zone trajectory.
 * Samples expose `u` / `v`. The scripted panel painter above is unchanged.
 */
export function createCoverageUV(renderer, traj, { width = 1024, height = 768, stampU = 0.06, stampV = 0.06, maxStamps = 8192 } = {}) {
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
        /* Local +Y is the cross-track. The quad is scaled to the pass pitch,
           so a band (not a probe-sized disc) meets the next pass. */
        float across = 1.0 - smoothstep(0.9, 1.0, abs(vQ.y));
        float along = 1.0 - smoothstep(0.86, 1.0, abs(vQ.x));
        float m = across * along;
        if (m < 0.02) discard;
        gl_FragColor = vec4(m, vT, 1.0, 1.0);
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

  const m4 = new THREE.Matrix4();
  const qBrush = new THREE.Quaternion();
  const sBrush = new THREE.Vector3();
  const pBrush = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const state = {};
  const ahead = {};
  let painted = 0;
  const step = 0.007;
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

  function paintTo(sTarget) {
    if (!traj || !traj.total) return;
    sTarget = Math.min(sTarget, traj.total);
    if (sTarget < painted - 1e-4) clear();
    if (sTarget <= painted) return;
    let n = 0;
    let s = painted === 0 ? 0 : painted + step;
    const pitchS = traj.pitchS || stampU;
    const pitchT = traj.pitchT || stampV;
    for (; s <= sTarget; s += step) {
      traj.at(s, state);
      if (!state.contact) continue;
      traj.at(Math.min(traj.total, s + step), ahead);
      let du = ahead.u - state.u;
      let dv = ahead.v - state.v;
      const span = Math.hypot(du, dv);
      if (span < 1e-6) {
        du = 1;
        dv = 0;
      } else {
        du /= span;
        dv /= span;
      }
      const pitch = Math.max(Math.hypot(pitchS * -dv, pitchT * du), 1e-4);
      /* Solid core runs to 0.9 of the quad, so 1.16× pitch overlaps the next pass. */
      const along = Math.max(span * 2.4, pitch * 0.45, 0.012);
      const cross = Math.max(pitch * 1.16, 0.014);
      qBrush.setFromAxisAngle(zAxis, Math.atan2(dv, du));
      sBrush.set(along, cross, 1);
      pBrush.set(state.u, state.v, 0);
      m4.compose(pBrush, qBrush, sBrush);
      mesh.setMatrixAt(n, m4);
      aTime.array[n] = s / traj.total;
      aGain.array[n] = 1;
      n++;
      if (n >= maxStamps) {
        flush(n);
        n = 0;
      }
    }
    flush(n);
    painted = sTarget;
  }

  function dispose() {
    rt.dispose();
    geo.dispose();
    mat.dispose();
  }

  clear();
  return { texture: rt.texture, paintTo, clear, dispose, get painted() { return painted; }, rt };
}
