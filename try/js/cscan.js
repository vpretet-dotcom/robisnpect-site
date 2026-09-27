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
