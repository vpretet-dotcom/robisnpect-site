/*
 * No-WebGL path for the your-turn step. Two stills per part (before the
 * path, and after the path plus C-scan) stand in for the 3D scene.
 * Buttons match the live step. Zone handles are not available here.
 */

export function mountFallbackTurn() {
  const root = document.getElementById('yt-fallback');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';
  root.hidden = false;

  const thumbs = [...root.querySelectorAll('.yt-thumb')];
  const zones = [...root.querySelectorAll('[data-zone]')];
  const weld = root.querySelector('.yt-weld');
  const rangeA = root.querySelector('[data-range="a"]');
  const rangeB = root.querySelector('[data-range="b"]');
  const error = root.querySelector('.yt-error');
  const before = root.querySelector('.ytf-before');
  const after = root.querySelector('.ytf-after');
  const frame = root.querySelector('.ytf-frame');
  const clip = root.querySelector('.ytf-clip');
  const overlay = root.querySelector('.ytf-zone');
  const STILL_W = 960;
  const STILL_H = 540;
  /*
   * Zone boxes are fractions of the still (same camera as the webp).
   * The silhouette mask clips them to the part outline.
   * Filled in after the still capture; defaults keep a visible highlight
   * until those fractions are written.
   */
  const ZONE_BOX = {
    weld: {
      all: [0.4083, 0.3994, 0.1772, 0.1884],
      center: [0.4556, 0.4405, 0.0883, 0.0981],
      edge: [0.5031, 0.3994, 0.0824, 0.0897],
    },
    panel: {
      all: [0.2073, 0.3626, 0.5642, 0.536],
      center: [0.3759, 0.4066, 0.2434, 0.199],
      edge: [0.2291, 0.3728, 0.2556, 0.1782],
    },
    elbow: {
      all: [0.3569, 0.3041, 0.2189, 0.5758],
      center: [0.4198, 0.3624, 0.1387, 0.324],
      edge: [0.3776, 0.3041, 0.1742, 0.1847],
    },
    fairing: {
      all: [0.3555, 0.3182, 0.2677, 0.6028],
      center: [0.429, 0.3562, 0.1185, 0.3069],
      edge: [0.3595, 0.3211, 0.0987, 0.1962],
    },
  };
  let part = 'panel';
  let phase = 'pick';
  let zone = { t0: 0.3, t1: 0.7, preset: 'center' };
  let busy = false;

  function show(next) {
    phase = next;
    root.dataset.phase = next;
  }

  function applyImages() {
    const base = `/try/yt/${part}`;
    if (before) before.src = `${base}-before.webp`;
    if (after) after.src = `${base}-after.webp`;
    const name = thumbs.find((b) => b.dataset.part === part)?.querySelector('.yt-thumb-name')?.textContent || part;
    if (before) before.alt = name;
    if (after) after.alt = name;
  }

  function fitFrame() {
    if (!frame) return;
    const view = frame.parentElement;
    if (!view) return;
    const vw = view.clientWidth;
    const vh = view.clientHeight;
    if (!vw || !vh) return;
    const scale = Math.max(vw / STILL_W, vh / STILL_H);
    const w = STILL_W * scale;
    const h = STILL_H * scale;
    frame.style.left = `${(vw - w) / 2}px`;
    frame.style.top = `${(vh - h) / 2}px`;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
  }

  function placeOverlay() {
    if (!overlay) return;
    fitFrame();
    if (clip) clip.style.webkitMaskImage = clip.style.maskImage = `url(/try/yt/${part}-mask.webp)`;
    const table = ZONE_BOX[part] || ZONE_BOX.panel;
    let box;
    if (part === 'weld' && !zone.preset) {
      const full = table.all;
      const span = Math.max(0.04, zone.t1 - zone.t0);
      box = [full[0] + (1 - zone.t1) * full[2], full[1], span * full[2], full[3]];
    } else {
      box = table[zone.preset] || table.center;
    }
    overlay.style.left = `${box[0] * 100}%`;
    overlay.style.top = `${box[1] * 100}%`;
    overlay.style.width = `${box[2] * 100}%`;
    overlay.style.height = `${box[3] * 100}%`;
  }

  function markPreset() {
    zones.forEach((b) => b.classList.toggle('on', b.dataset.zone === zone.preset));
  }

  function syncSliders() {
    if (!rangeA) return;
    rangeA.value = String(Math.round(zone.t0 * 1000));
    rangeB.value = String(Math.round(zone.t1 * 1000));
  }

  async function pick(id) {
    if (busy) return;
    const btn = thumbs.find((b) => b.dataset.part === id);
    busy = true;
    if (btn) {
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
    }
    await new Promise((r) => setTimeout(r, 420));
    part = id;
    thumbs.forEach((b) => b.classList.toggle('on', b.dataset.part === id));
    zone = { t0: 0.3, t1: 0.7, preset: 'center' };
    root.classList.remove('is-drawn', 'is-done');
    if (error) error.hidden = true;
    applyImages();
    if (weld) weld.hidden = id !== 'weld';
    syncSliders();
    markPreset();
    placeOverlay();
    if (btn) {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
    }
    busy = false;
    show('zone');
  }

  function setPreset(name) {
    zone.preset = name;
    if (name === 'all') {
      zone.t0 = 0.02;
      zone.t1 = 0.98;
    } else if (name === 'edge') {
      zone.t0 = 0;
      zone.t1 = 0.38;
    } else {
      zone.t0 = 0.3;
      zone.t1 = 0.7;
    }
    if (error) error.hidden = true;
    syncSliders();
    markPreset();
    placeOverlay();
  }

  function onSlider(which) {
    let a = Number(rangeA.value) / 1000;
    let b = Number(rangeB.value) / 1000;
    if (b < a + 0.04) {
      if (which === 'a') b = Math.min(1, a + 0.04);
      else a = Math.max(0, b - 0.04);
    }
    zone.t0 = a;
    zone.t1 = b;
    zone.preset = '';
    rangeA.value = String(Math.round(a * 1000));
    rangeB.value = String(Math.round(b * 1000));
    if (error) error.hidden = true;
    markPreset();
    placeOverlay();
  }

  function tooSmall() {
    return part === 'weld' && (zone.t1 - zone.t0) * 0.4 < 0.05;
  }

  function compute() {
    if (phase !== 'zone') return;
    if (tooSmall()) {
      if (error) error.hidden = false;
      return;
    }
    if (error) error.hidden = true;
    show('drawing');
    root.classList.add('is-drawn');
    window.setTimeout(() => {
      if (phase !== 'drawing') return;
      show('done');
      root.classList.add('is-done');
    }, 1700);
  }

  thumbs.forEach((b) => b.addEventListener('click', () => pick(b.dataset.part)));
  zones.forEach((b) => b.addEventListener('click', () => {
    if (phase === 'zone') setPreset(b.dataset.zone);
  }));
  rangeA?.addEventListener('input', () => onSlider('a'));
  rangeB?.addEventListener('input', () => onSlider('b'));
  root.querySelector('.yt-compute')?.addEventListener('click', compute);
  root.querySelector('.yt-again')?.addEventListener('click', () => {
    root.classList.remove('is-drawn', 'is-done');
    if (error) error.hidden = true;
    show('pick');
  });

  thumbs.forEach((b) => b.classList.toggle('on', b.dataset.part === 'panel'));
  if (weld) weld.hidden = true;
  applyImages();
  markPreset();
  placeOverlay();
  show('pick');
  window.addEventListener('resize', fitFrame);
  if (before) before.addEventListener('load', fitFrame);
}
