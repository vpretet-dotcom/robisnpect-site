import * as THREE from 'three';

/** Uniforms shared by every patched material (one object, so updates propagate). */
export const FX = {
  uTime: { value: 0 },
  uPartReveal: { value: 2 },
  uPartRevealOn: { value: 0 },
  uArmReveal: { value: 4 },
  uArmRevealOn: { value: 0 },
};

export const GOLD_LIN = new THREE.Color(0xe8c547).convertSRGBToLinear();

// Punctual lights on glossy coats produce sun-like glints that bloom into
// blobs; softbox reflections come from the environment map instead. A soft
// knee (not min) keeps the highlight falloff smooth instead of a flat disc.
const DEFAULT_CLAMP = [0.7, 0.75, 0.6, 0.7];
const specClamp = ([d, i, cd, ci]) => `
  reflectedLight.directSpecular = fxKnee(reflectedLight.directSpecular, ${d.toFixed(3)});
  reflectedLight.indirectSpecular = fxKnee(reflectedLight.indirectSpecular, ${i.toFixed(3)});
  #ifdef USE_CLEARCOAT
    clearcoatSpecularDirect = fxKnee(clearcoatSpecularDirect, ${cd.toFixed(3)});
    clearcoatSpecularIndirect = fxKnee(clearcoatSpecularIndirect, ${ci.toFixed(3)});
  #endif
`;

/**
 * Injects GLSL snippets into a MeshStandard/MeshPhysical material.
 * Every patched shader gets vFxW (world position) and vFxUv (uv).
 */
export function patchMaterial(mat, parts, key) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FX, parts.uniforms || {});
    const shared = `varying vec3 vFxW;\nvarying vec2 vFxUv;\nuniform float uTime;\nuniform float uPartReveal;\nuniform float uPartRevealOn;\nuniform float uArmReveal;\nuniform float uArmRevealOn;\n`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${shared}${parts.vertPars || ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>\nvFxW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFxUv = uv;\n${parts.vertMain || ''}`
      );
    const knee = `vec3 fxKnee(vec3 x, float c) { float a = 0.5 * c; return min(x, vec3(a)) + (c - a) * (1.0 - exp(-max(x - a, 0.0) / (c - a))); }\n`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${shared}${knee}${parts.fragPars || ''}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${parts.fragStart || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${parts.fragColor || ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${parts.fragEmissive || ''}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${parts.fragMaterial || ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${specClamp(parts.specClamp || DEFAULT_CLAMP)}`)
      .replace('#include <opaque_fragment>', `${parts.fragFinal || ''}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Sweep along world X (the part materialises from CAD). */
export const REVEAL_X = {
  fragStart: `
    float fxFront = uPartReveal - (vFxW.x * 0.86 + 0.5);
    if (uPartRevealOn > 0.5 && fxFront < 0.0) discard;
  `,
  fragEmissive: `
    totalEmissiveRadiance += vec3(1.0, 0.66, 0.16) * 3.2 * uPartRevealOn * (1.0 - smoothstep(0.0, 0.014, abs(fxFront)));
  `,
};

/** Sweep up world Y (the arm materialises). */
export const REVEAL_Y = {
  fragStart: `
    float fxFrontY = uArmReveal - vFxW.y + 0.018 * sin(vFxW.x * 70.0) * sin(vFxW.z * 70.0);
    if (uArmRevealOn > 0.5 && fxFrontY < 0.0) discard;
  `,
  fragEmissive: `
    totalEmissiveRadiance += vec3(1.0, 0.66, 0.16) * 3.0 * uArmRevealOn * (1.0 - smoothstep(0.0, 0.02, abs(fxFrontY)));
  `,
};

export function withReveal(mat, reveal, key) {
  return patchMaterial(mat, reveal, key);
}

/** Radial gold glow sprite texture (for the path head, dust, LEDs). */
export function makeGlowTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
