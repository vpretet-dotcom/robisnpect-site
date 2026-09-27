export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const saturate = (x) => clamp(x, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => saturate((x - a) / (b - a));

export function smoothstep(a, b, x) {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

/** Remaps x from [a,b] to [0,1], clamps, then applies an easing function. */
export const phase = (x, a, b, ease = easeInOutCubic) => ease(invLerp(a, b, x));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise in [0,1]. */
export function makeNoise2D(seed = 1) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const h = (x, y) => vals[perm[(perm[x & 255] + y) & 255]];
  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function fbm(noise, x, y, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Critically damped spring step for a scalar (value, velocity) pair. */
export function springStep(state, target, omega, dt) {
  const x = state.x - target;
  const exp = Math.exp(-omega * dt);
  const temp = (state.v + omega * x) * dt;
  state.v = (state.v - omega * temp) * exp;
  state.x = target + (x + temp) * exp;
  return state.x;
}

export function unwrapNear(angle, reference) {
  const TAU = Math.PI * 2;
  return angle + Math.round((reference - angle) / TAU) * TAU;
}
