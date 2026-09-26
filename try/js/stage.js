import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FX, GOLD_LIN, patchMaterial } from './fx.js';

export const TIERS = {
  high: { name: 'high', dpr: 2, maxPixels: 3.4e6, samples: 4, bloom: true, shadow: 2048, dust: 170, cover: 1024, field: 512 },
  medium: { name: 'medium', dpr: 1.5, maxPixels: 1.7e6, samples: 2, bloom: true, shadow: 1024, dust: 90, cover: 1024, field: 512 },
  low: { name: 'low', dpr: 1, maxPixels: 0.95e6, samples: 0, bloom: false, shadow: 1024, dust: 0, cover: 512, field: 384 },
};
export const TIER_ORDER = ['high', 'medium', 'low'];

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    toneMappingExposure: { value: 1 },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.42 },
    uFade: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
    attribute vec3 position; attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uFade; uniform vec2 uRes;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      q.x *= uRes.x / uRes.y;
      float r = length(q);
      c.rgb += vec3(0.0032, 0.0028, 0.0021) * (1.0 - smoothstep(0.0, 0.8, r));
      c.rgb = NeutralToneMapping(c.rgb);
      c = sRGBTransferOETF(c);
      c.rgb *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);
      float g = hash(gl_FragCoord.xy + fract(uTime * 7.13) * 91.7) - 0.5;
      c.rgb += g * uGrain;
      c.rgb *= uFade;
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

class FinalPass extends Pass {
  constructor() {
    super();
    this.uniforms = THREE.UniformsUtils.clone(FinalShader.uniforms);
    this.material = new THREE.RawShaderMaterial({
      name: 'FinalPass',
      uniforms: this.uniforms,
      vertexShader: FinalShader.vertexShader,
      fragmentShader: FinalShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

function makeStudioEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(20, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; void main(){ float h = vDir.y; vec3 c = mix(vec3(0.006,0.0055,0.005), vec3(0.03,0.026,0.021), smoothstep(-0.3, 0.9, h)); gl_FragColor = vec4(c, 1.0); }`,
    })
  );
  env.add(dome);
  const box = (w, h, color, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(look);
    env.add(m);
  };
  const o = new THREE.Vector3(0, 0, 0);
  box(9, 4, new THREE.Color(3.4, 3.3, 3.1), new THREE.Vector3(0, 9, 1), o);
  box(1.4, 7, new THREE.Color(1.7, 1.66, 1.58), new THREE.Vector3(-9, 3, 3), o);
  box(1.2, 7, new THREE.Color(1.7, 1.24, 0.46), new THREE.Vector3(8, 3, -5), o);
  box(9, 2.6, new THREE.Color(3.2, 2.9, 2.3), new THREE.Vector3(0, 3.4, -10), o);
  box(2.4, 5, new THREE.Color(1.2, 1.15, 1.08), new THREE.Vector3(7, 4, 6), o);
  box(8, 1.0, new THREE.Color(0.3, 0.3, 0.29), new THREE.Vector3(2, 0.6, 9), o);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  env.traverse((m) => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  });
  return rt.texture;
}

function makeFloor() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.12 });
  patchMaterial(
    mat,
    {
      uniforms: { uGold: { value: GOLD_LIN.clone() }, uCell: { value: new THREE.Vector4(-1.25, 1.25, -2.15, 1.05) } },
      fragPars: `uniform vec3 uGold; uniform vec4 uCell;
        float fxLine(float d, float w) { float aa = fwidth(d) * 1.5; return 1.0 - smoothstep(w, w + aa, abs(d)); }`,
      fragColor: `
        vec2 fp = vFxW.xz;
        float rr = length((fp - vec2(0.0, -0.45)) * vec2(0.8, 1.0));
        float floorFade = 1.0 - smoothstep(1.1, 4.2, rr);
        diffuseColor.rgb *= 0.12 + 0.88 * floorFade;
      `,
      fragEmissive: `
        float inX = step(uCell.x, fp.x) * step(fp.x, uCell.y);
        float inZ = step(uCell.z, fp.y) * step(fp.y, uCell.w);
        float cell = max((fxLine(fp.x - uCell.x, 0.006) + fxLine(fp.x - uCell.y, 0.006)) * inZ,
                         (fxLine(fp.y - uCell.z, 0.006) + fxLine(fp.y - uCell.w, 0.006)) * inX);
        vec2 gq = fp * 2.0;
        vec2 gg = abs(fract(gq - 0.5) - 0.5) / max(fwidth(gq), vec2(1e-5));
        float grid = 1.0 - smoothstep(0.0, 1.0, min(gg.x, gg.y));
        totalEmissiveRadiance += uGold * (cell * 0.075 + grid * 0.006) * floorFade;
      `,
      fragFinal: `outgoingLight *= floorFade;`,
    },
    'floor'
  );
  const m = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function makeDust(count, glow) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  const r = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * 4.2;
    p[i * 3 + 1] = 0.15 + Math.random() * 2.4;
    p[i * 3 + 2] = -2.4 + Math.random() * 3.6;
    r[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(r, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: FX.uTime, uMap: { value: glow }, uScale: { value: 1 } },
    vertexShader: `attribute float aR; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        vec3 q = position;
        q.x += sin(uTime * (0.05 + aR * 0.08) + aR * 40.0) * 0.18;
        q.y += sin(uTime * (0.04 + aR * 0.05) + aR * 17.0) * 0.12;
        q.z += cos(uTime * (0.05 + aR * 0.06) + aR * 29.0) * 0.16;
        vec4 mv = modelViewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.9 + aR * 1.8) * (3.0 / -mv.z);
        vA = (0.05 + 0.2 * aR * aR) * smoothstep(0.3, 1.6, -mv.z);
      }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA;
      void main(){ float a = texture2D(uMap, gl_PointCoord).r * vA; gl_FragColor = vec4(vec3(1.0, 0.88, 0.66), a); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

export function createStage(container, { tier, capture = false, glowTexture }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'xp-gl';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: capture,
  });
  renderer.setClearColor(0x050505, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const halfFloatOK = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050505);
  scene.fog = new THREE.FogExp2(0x050505, 0.055);
  scene.environment = makeStudioEnvironment(renderer);
  scene.environmentIntensity = 0.72;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);

  const key = new THREE.DirectionalLight(0xfff7ee, 2.1);
  key.position.set(-2.3, 4.8, 2.4);
  key.target.position.set(0, 0.7, -0.45);
  key.castShadow = true;
  const sc = key.shadow.camera;
  sc.left = -2.1;
  sc.right = 2.1;
  sc.top = 2.1;
  sc.bottom = -2.1;
  sc.near = 1;
  sc.far = 12;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xffd27a, 2.3);
  rim.position.set(2.8, 3.1, -4.4);
  rim.target.position.set(0, 0.9, -0.6);
  scene.add(rim, rim.target);

  const fill = new THREE.HemisphereLight(0x232321, 0x050505, 0.3);
  scene.add(fill);

  const pool = new THREE.SpotLight(0xfff0dc, 3.2, 6, 0.55, 0.95, 1.4);
  pool.position.set(0.2, 3.4, 1.1);
  pool.target.position.set(0, 0.8, 0);
  scene.add(pool, pool.target);

  scene.add(makeFloor());

  let dust = null;

  let composer = null;
  let bloom = null;
  let finalPass = null;
  let current = null;
  let width = 1;
  let height = 1;
  let dpr = 1;

  function buildComposer(t) {
    if (!halfFloatOK) return;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: t.samples });
    if (!composer) {
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 1.25);
      composer.addPass(bloom);
      finalPass = new FinalPass();
      composer.addPass(finalPass);
    } else {
      composer.reset(rt);
    }
    bloom.enabled = t.bloom;
  }

  function applyTier(name) {
    const t = TIERS[name];
    current = t;
    key.shadow.mapSize.set(t.shadow, t.shadow);
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
    if (dust) {
      scene.remove(dust);
      dust.geometry.dispose();
      dust.material.dispose();
      dust = null;
    }
    if (t.dust > 0) {
      dust = makeDust(t.dust, glowTexture);
      scene.add(dust);
    }
    buildComposer(t);
    resize();
  }

  function resize() {
    const r = container.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    const t = current;
    const native = window.devicePixelRatio || 1;
    dpr = Math.min(native, t.dpr, Math.sqrt(t.maxPixels / (width * height)));
    dpr = Math.max(dpr, 0.6);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(dpr);
      composer.setSize(width, height);
      bloom.resolution.set(width * dpr, height * dpr);
      finalPass.uniforms.uRes.value.set(width, height);
    }
    if (dust) dust.material.uniforms.uScale.value = height * dpr * 0.0022;
  }

  function render(time) {
    if (finalPass) finalPass.uniforms.uTime.value = time;
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  function setFade(v) {
    if (finalPass) finalPass.uniforms.uFade.value = v;
  }

  function setShadowStrength(v) {
    key.shadow.intensity = v;
  }

  applyTier(tier);

  return {
    renderer,
    scene,
    camera,
    canvas,
    render,
    resize,
    applyTier,
    setFade,
    setShadowStrength,
    get tier() {
      return current.name;
    },
    get size() {
      return { width, height, dpr };
    },
    get info() {
      return { halfFloatOK, composer: !!composer };
    },
  };
}
